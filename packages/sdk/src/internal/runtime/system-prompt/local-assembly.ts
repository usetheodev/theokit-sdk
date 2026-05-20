import type { AgentOptions, ModelSelection, SystemPromptContext } from "../../../types/agent.js";
import type { FileContextManager } from "../context-manager.js";
import type { MemoryFact } from "../memory-store.js";
import type { SkillsManager } from "../skills-manager.js";
import type { SystemPromptPipeline } from "./pipeline.js";
import type { SystemPromptAssemblyContext } from "./types.js";

/**
 * Bundles the per-agent state that the assembly helpers need without forcing
 * LocalAgent to expose private fields. Extracted from LocalAgent so the parent
 * class stays under the G8 LoC budget.
 *
 * @internal
 */
export interface LocalAssemblyInputs {
  agentId: string;
  workspaceCwd: string;
  model: ModelSelection | undefined;
  options: AgentOptions;
  context: FileContextManager | undefined;
  skillsManager: SkillsManager | undefined;
  systemPromptPipeline: SystemPromptPipeline;
}

/**
 * Build the base {@link SystemPromptContext} surfaced to a resolver function.
 * Resolves skills lazily — never throws when the manager is absent.
 *
 * @internal
 */
export async function buildSystemPromptContext(
  inputs: LocalAssemblyInputs,
  userText: string,
  memoryFacts: ReadonlyArray<MemoryFact>,
): Promise<SystemPromptContext> {
  const skills = inputs.skillsManager !== undefined ? await inputs.skillsManager.list() : [];
  return {
    agentId: inputs.agentId,
    cwd: inputs.workspaceCwd,
    model: inputs.model,
    skills: skills.map((skill) => ({ name: skill.name, description: skill.description })),
    userMessage: userText,
    memory: memoryFacts.map((fact) => ({ text: fact.text })),
  };
}

/**
 * Build the full {@link SystemPromptAssemblyContext} that the pipeline
 * consumes, including the optional active-memory summary and context snapshot.
 *
 * @internal
 */
export async function buildAssemblyContext(
  inputs: LocalAssemblyInputs,
  userText: string,
  baseSystemPrompt: string | undefined,
  memoryFacts: ReadonlyArray<MemoryFact>,
  activeMemorySummary: string | undefined,
): Promise<SystemPromptAssemblyContext> {
  const baseCtx = await buildSystemPromptContext(inputs, userText, memoryFacts);
  const assemblyCtx: SystemPromptAssemblyContext = {
    ...baseCtx,
    skillsAutoInject: inputs.options.skills?.autoInject ?? true,
    memoryAutoInject: inputs.options.memory?.autoInject ?? true,
  };
  if (baseSystemPrompt !== undefined) assemblyCtx.baseSystemPrompt = baseSystemPrompt;
  if (activeMemorySummary !== undefined && activeMemorySummary.length > 0) {
    assemblyCtx.activeMemorySummary = activeMemorySummary;
  }
  if (inputs.context !== undefined) {
    const internal = inputs.context.internalAssemblySnapshot();
    assemblyCtx.contextSnapshot = { sources: internal.sources };
    if (internal.maxTokens !== undefined) assemblyCtx.contextMaxTokens = internal.maxTokens;
  }
  return assemblyCtx;
}

/**
 * Convenience wrapper: build the assembly context and run it through the
 * pipeline in one call. Returns the final system-prompt string (or undefined
 * if the pipeline produces no output).
 *
 * @internal
 */
export async function assembleSystemPromptForSend(
  inputs: LocalAssemblyInputs,
  userText: string,
  baseSystemPrompt: string | undefined,
  memoryFacts: ReadonlyArray<MemoryFact>,
  activeMemorySummary: string | undefined,
): Promise<string | undefined> {
  const ctx = await buildAssemblyContext(
    inputs,
    userText,
    baseSystemPrompt,
    memoryFacts,
    activeMemorySummary,
  );
  return inputs.systemPromptPipeline.assemble(ctx);
}
