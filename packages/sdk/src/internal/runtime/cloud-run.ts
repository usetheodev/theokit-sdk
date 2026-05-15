import { generateRunId } from "../ids.js";
import type { AgentOptions, ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type {
  Run,
  RunGitInfo,
  RunOperation,
  RunResult,
  RunStatus,
  SDKUserMessage,
  SendOptions,
} from "../../types/run.js";
import { buildFixtureScript, type FixtureScript } from "./fixture-responder.js";

/**
 * Options accepted by `createCloudRun()`.
 *
 * @internal
 */
export interface CreateCloudRunOptions {
  agentId: string;
  model: ModelSelection;
  message: string | SDKUserMessage;
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
}

/**
 * Build a cloud Run handle. In fixture mode, mimics Theo PaaS behavior
 * (CREATING/RUNNING/FINISHED status events + git metadata on result).
 *
 * @internal
 */
export function createCloudRun(options: CreateCloudRunOptions): Run {
  const userText = typeof options.message === "string" ? options.message : options.message.text;
  const id = generateRunId();
  const startTime = Date.now();
  const supported = new Set<RunOperation>([
    "stream",
    "wait",
    "cancel",
    "conversation",
    "listArtifacts",
    "downloadArtifact",
  ]);

  const script = buildFixtureScript({
    agentId: options.agentId,
    runId: id,
    model: options.model,
    userMessage: userText,
    runtime: "cloud",
    agentOptions: options.agentOptions,
    sendOptions: options.sendOptions,
    workspaceCwd: undefined,
    subagents: {},
    settingSourcesIncludeProject: false,
    memoryFacts: [],
    sessionMessages: [],
    projectMcpServers: {},
  });

  const handle = new CloudRun({
    id,
    agentId: options.agentId,
    model: options.model,
    script,
    supportedOps: supported,
    startTime,
    git: buildGitInfo(options),
  });
  handle.bootstrap();
  return handle;
}

interface CloudRunCtorOptions {
  id: string;
  agentId: string;
  model: ModelSelection;
  script: FixtureScript;
  supportedOps: Set<RunOperation>;
  startTime: number;
  git: RunGitInfo;
}

class CloudRun implements Run {
  readonly id: string;
  readonly agentId: string;
  status: RunStatus = "running";
  result?: string;
  model?: ModelSelection;
  durationMs?: number;
  git?: RunGitInfo;
  createdAt?: number;

  private readonly script: FixtureScript;
  private readonly supportedOps: Set<RunOperation>;
  private readonly startTime: number;
  private readonly listeners = new Set<(status: RunStatus) => void>();
  private terminationPromise: Promise<RunResult>;
  private resolveTermination!: (value: RunResult) => void;
  private terminated = false;
  private readonly gitInfo: RunGitInfo;

  constructor(options: CloudRunCtorOptions) {
    this.id = options.id;
    this.agentId = options.agentId;
    this.model = options.model;
    this.script = options.script;
    this.supportedOps = options.supportedOps;
    this.startTime = options.startTime;
    this.createdAt = options.startTime;
    this.gitInfo = options.git;
    this.git = options.git;
    this.terminationPromise = new Promise<RunResult>((resolve) => {
      this.resolveTermination = resolve;
    });
  }

  bootstrap(): void {
    if (this.script.cancellable) return;
    setTimeout(() => this.complete(this.script.finalStatus), 0);
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
    this.complete("cancelled");
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

  private complete(nextStatus: RunStatus): void {
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
      git: this.gitInfo,
    };
    if (status === "finished" || status === "error") {
      if (this.script.result !== undefined) final.result = this.script.result;
    }
    return final;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch {
        // listeners are user code, never propagate
      }
    }
  }
}

function buildGitInfo(_options: CreateCloudRunOptions): RunGitInfo {
  return {
    branches: [
      {
        repoUrl: "https://github.com/usetheo/example",
        branch: "feat/contract-fixture",
        prUrl: "https://github.com/usetheo/example/pull/1",
      },
    ],
  };
}
