import type { AgentDefinition, AgentOptions, ModelSelection } from "../../types/agent.js";
import type { Run, RunOperation, RunStatus, SDKUserMessage, SendOptions } from "../../types/run.js";
import type { SessionMessage } from "./agent-session.js";
import { DEFAULT_AGENTIC_MODEL_ID } from "./default-model.js";
import { buildFixtureScript } from "./fixture-responder.js";
import { FixtureRunBase, prepareRunContext } from "./fixture-run-base.js";
import type { MemoryFact } from "./memory-store.js";
import { registerRun } from "./run-registry.js";

/**
 * Options accepted by `createLocalRun()`.
 *
 * @internal
 */
export interface CreateLocalRunOptions {
  agentId: string;
  model: ModelSelection | undefined;
  message: string | SDKUserMessage;
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
  workspaceCwd: string;
  subagents: Record<string, AgentDefinition>;
  settingSourcesIncludeProject: boolean;
  memoryFacts: MemoryFact[];
  sessionMessages: SessionMessage[];
  projectMcpServers: Record<string, unknown>;
  persistMemoryFact?: (fact: MemoryFact) => Promise<void>;
  /**
   * Accepted for API parity with the real runtime; the fixture responder is
   * deterministic and does not feed the prompt into its scripts.
   */
  systemPrompt?: string;
}

/**
 * Build a local Run handle backed by the in-process fixture responder.
 *
 * @internal
 */
export function createLocalRun(options: CreateLocalRunOptions): Run {
  const { userText, id, startTime } = prepareRunContext(options.message);
  const supported = new Set<RunOperation>(["stream", "wait", "cancel", "conversation"]);

  const script = buildFixtureScript({
    agentId: options.agentId,
    runId: id,
    model: options.model ?? { id: DEFAULT_AGENTIC_MODEL_ID },
    userMessage: userText,
    runtime: "local",
    agentOptions: options.agentOptions,
    sendOptions: options.sendOptions,
    workspaceCwd: options.workspaceCwd,
    subagents: options.subagents,
    settingSourcesIncludeProject: options.settingSourcesIncludeProject,
    memoryFacts: options.memoryFacts,
    sessionMessages: options.sessionMessages,
    projectMcpServers: options.projectMcpServers,
    ...(options.persistMemoryFact !== undefined
      ? { persistMemoryFact: options.persistMemoryFact }
      : {}),
  });

  const handle = new LocalRun({
    id,
    agentId: options.agentId,
    model: options.model,
    script,
    supportedOps: supported,
    startTime,
  });
  handle.bootstrap();
  registerRun(handle);
  return handle;
}

class LocalRun extends FixtureRunBase {
  bootstrap(): void {
    if (this.script.cancellable) return;
    setTimeout(() => {
      void this.completeNaturally();
    }, 0);
  }

  protected override notifyImmediately(): boolean {
    // Local agents emit the "running" state synchronously to subscribers;
    // tests rely on observing the transition even when added pre-completion.
    return true;
  }

  private async completeNaturally(): Promise<void> {
    if (this.terminated) return;
    if (this.script.beforeComplete !== undefined) {
      try {
        await this.script.beforeComplete();
      } catch {
        this.transitionTo("error" satisfies RunStatus);
        return;
      }
    }
    this.transitionTo(this.script.finalStatus);
  }
}
