/**
 * Dispatch helpers extracted from `LocalAgent` to keep its file under
 * G8 (≤400 LoC). Builds the args for real-LLM and fixture run paths.
 *
 * @internal
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition, AgentOptions, ModelSelection } from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import type { MemoryToolSpec } from "../agent-loop/loop-types.js";
import type { PluginManager } from "../plugins/manager.js";
import { getSessionMessages } from "./agent-session.js";
import type { HooksExecutor } from "./hooks-executor.js";
import { createLocalRun } from "./local-run.js";
import type { MemoryFact } from "./memory-store.js";
import type { createRealLocalRun } from "./real-local-run.js";

export interface DispatchInputs {
  agentId: string;
  model: ModelSelection | undefined;
  options: AgentOptions;
  workspaceCwd: string;
  hooksExecutor: HooksExecutor;
  pluginManager: PluginManager;
  resolvedSubagents: Record<string, AgentDefinition>;
  settingSourcesIncludeProject: boolean;
}

export function buildRealRunOptions(args: {
  inputs: DispatchInputs;
  message: string | SDKUserMessage;
  options: SendOptions;
  systemPrompt: string | undefined;
  priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
  memoryTools: ReadonlyArray<MemoryToolSpec> | undefined;
  personalityToolWhitelist?: ReadonlyArray<string>;
  personalityName?: string;
}): Parameters<typeof createRealLocalRun>[0] {
  return {
    agentId: args.inputs.agentId,
    model: args.inputs.model,
    message: args.message,
    agentOptions: args.inputs.options,
    sendOptions: args.options,
    workspaceCwd: args.inputs.workspaceCwd,
    hooks: args.inputs.hooksExecutor,
    pluginManager: args.inputs.pluginManager,
    ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
    ...(args.options.onStep !== undefined ? { onStep: args.options.onStep } : {}),
    ...(args.options.onDelta !== undefined ? { onDelta: args.options.onDelta } : {}),
    ...(args.priorMessages.length > 0 ? { priorMessages: args.priorMessages } : {}),
    ...(args.memoryTools !== undefined && args.memoryTools.length > 0
      ? { memoryTools: args.memoryTools }
      : {}),
    ...(args.personalityToolWhitelist !== undefined
      ? { personalityToolWhitelist: args.personalityToolWhitelist }
      : {}),
    ...(args.personalityName !== undefined ? { personalityName: args.personalityName } : {}),
  };
}

export async function createFixtureRunHelper(args: {
  inputs: DispatchInputs;
  message: string | SDKUserMessage;
  options: SendOptions;
  systemPrompt: string | undefined;
  memoryFacts: ReadonlyArray<MemoryFact>;
}): Promise<Run> {
  const sessionMessages = getSessionMessages(args.inputs.agentId);
  const projectMcpServers = args.inputs.settingSourcesIncludeProject
    ? await readProjectMcpServers(args.inputs.workspaceCwd)
    : {};
  return createLocalRun({
    agentId: args.inputs.agentId,
    model: args.inputs.model,
    message: args.message,
    agentOptions: args.inputs.options,
    sendOptions: args.options,
    workspaceCwd: args.inputs.workspaceCwd,
    subagents: args.inputs.resolvedSubagents,
    settingSourcesIncludeProject: args.inputs.settingSourcesIncludeProject,
    memoryFacts: [...args.memoryFacts],
    sessionMessages,
    projectMcpServers,
    ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
  });
}

async function readProjectMcpServers(cwd: string): Promise<Record<string, unknown>> {
  const path = join(cwd, ".theokit", "mcp.json");
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { servers?: Record<string, unknown> };
    return parsed.servers ?? {};
  } catch {
    return {};
  }
}
