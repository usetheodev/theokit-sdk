import { generateRunId } from "../ids.js";
import type { AgentDefinition, AgentOptions, ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type {
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKUserMessage,
  SendOptions,
} from "../../types/run.js";
import type { SessionMessage } from "./agent-session.js";
import {
  applyExtraRunFields,
  buildFixtureScript,
  type FixtureScript,
} from "./fixture-responder.js";
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
}

/**
 * Build a local Run handle backed by the in-process fixture responder.
 *
 * @internal
 */
export function createLocalRun(options: CreateLocalRunOptions): Run {
  const userText = typeof options.message === "string" ? options.message : options.message.text;
  const id = generateRunId();
  const startTime = Date.now();
  const supported = new Set<RunOperation>([
    "stream",
    "wait",
    "cancel",
    "conversation",
  ]);

  const script = buildFixtureScript({
    agentId: options.agentId,
    runId: id,
    model: options.model ?? { id: "composer-2" },
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

interface LocalRunCtorOptions {
  id: string;
  agentId: string;
  model: ModelSelection | undefined;
  script: FixtureScript;
  supportedOps: Set<RunOperation>;
  startTime: number;
}

class LocalRun implements Run {
  readonly id: string;
  readonly agentId: string;
  status: RunStatus = "running";
  result?: string;
  model?: ModelSelection;
  durationMs?: number;
  createdAt?: number;

  private readonly script: FixtureScript;
  private readonly supportedOps: Set<RunOperation>;
  private readonly startTime: number;
  private readonly listeners = new Set<(status: RunStatus) => void>();
  private terminationPromise: Promise<RunResult>;
  private resolveTermination!: (value: RunResult) => void;
  private terminated = false;

  constructor(options: LocalRunCtorOptions) {
    this.id = options.id;
    this.agentId = options.agentId;
    if (options.model !== undefined) this.model = options.model;
    this.script = options.script;
    this.supportedOps = options.supportedOps;
    this.startTime = options.startTime;
    this.createdAt = options.startTime;
    this.terminationPromise = new Promise<RunResult>((resolve) => {
      this.resolveTermination = resolve;
    });
  }

  bootstrap(): void {
    if (this.script.cancellable) return;
    setTimeout(() => {
      void this.completeNaturally();
    }, 0);
  }

  async *stream(): AsyncGenerator<SDKMessage, void> {
    for (const event of this.script.events) {
      yield event;
    }
    await this.terminationPromise;
  }

  wait(): Promise<RunResult> {
    return this.terminationPromise;
  }

  cancel(): Promise<void> {
    if (this.terminated) return Promise.resolve();
    this.transitionTo("cancelled");
    return Promise.resolve();
  }

  conversation(): Promise<ConversationTurn[]> {
    return Promise.resolve(this.script.conversation);
  }

  supports(op: RunOperation): boolean {
    return this.supportedOps.has(op);
  }

  unsupportedReason(op: RunOperation): string | undefined {
    return this.supportedOps.has(op) ? undefined : `Operation ${op} is not supported`;
  }

  onDidChangeStatus(listener: (status: RunStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async completeNaturally(): Promise<void> {
    if (this.terminated) return;
    if (this.script.beforeComplete !== undefined) {
      try {
        await this.script.beforeComplete();
      } catch {
        // Surface as error status instead of letting the run hang.
        this.transitionTo("error");
        return;
      }
    }
    this.transitionTo(this.script.finalStatus);
  }

  private transitionTo(nextStatus: RunStatus): void {
    if (this.terminated) return;
    this.terminated = true;
    this.status = nextStatus;
    this.durationMs = Date.now() - this.startTime;
    if (nextStatus !== "cancelled" && this.script.result !== undefined) {
      this.result = this.script.result;
    }
    this.notifyListeners();
    this.resolveTermination(this.buildResult(nextStatus));
  }

  private buildResult(status: RunStatus): RunResult {
    const final: RunResult = {
      id: this.id,
      status: status === "running" ? "finished" : status,
      ...(this.model !== undefined ? { model: this.model } : {}),
      durationMs: this.durationMs ?? Date.now() - this.startTime,
    };
    if (status === "finished" || status === "error") {
      if (this.script.result !== undefined) final.result = this.script.result;
    }
    return applyExtraRunFields(final, this.script);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch {
        // listeners are user code; never propagate
      }
    }
  }
}
