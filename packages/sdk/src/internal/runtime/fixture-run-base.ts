import type { ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type { Run, RunOperation, RunResult, RunStatus, SDKUserMessage } from "../../types/run.js";
import { generateRunId } from "../ids.js";
import { applyExtraRunFields } from "./fixture-responder.js";
import type { FixtureScript } from "./fixture-types.js";

/**
 * Shared bootstrap state extracted from `createLocalRun` / `createCloudRun`.
 * Keeps the body of each factory readable while avoiding a tiny duplicated
 * preamble.
 *
 * @internal
 */
export function prepareRunContext(message: string | SDKUserMessage): {
  userText: string;
  id: string;
  startTime: number;
} {
  const userText = typeof message === "string" ? message : message.text;
  return { userText, id: generateRunId(), startTime: Date.now() };
}

/**
 * Shared state machine backing both `LocalRun` and `CloudRun`. Subclasses
 * override `bootstrap()` and `extendRunResult()` to inject runtime-specific
 * lifecycle behavior (async beforeComplete, git metadata) without
 * duplicating the surrounding plumbing.
 *
 * @internal
 */
export interface FixtureRunBaseOptions {
  id: string;
  agentId: string;
  model: ModelSelection | undefined;
  script: FixtureScript;
  supportedOps: Set<RunOperation>;
  startTime: number;
}

export abstract class FixtureRunBase implements Run {
  readonly id: string;
  readonly agentId: string;
  status: RunStatus = "running";
  result?: string;
  model?: ModelSelection;
  durationMs?: number;
  createdAt?: number;

  protected readonly script: FixtureScript;
  protected readonly startTime: number;
  protected readonly supportedOps: Set<RunOperation>;
  protected readonly listeners = new Set<(status: RunStatus) => void>();
  protected readonly terminationPromise: Promise<RunResult>;
  protected resolveTermination!: (value: RunResult) => void;
  protected terminated = false;
  private eventNotifier: { promise: Promise<void>; resolve: () => void };

  constructor(options: FixtureRunBaseOptions) {
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
    this.eventNotifier = makeNotifier();
  }

  abstract bootstrap(): void;

  /**
   * Subclasses driving real (non-fixture) runtimes should call this after
   * pushing a new event into `this.script.events` so that already-awaiting
   * consumers of `stream()` wake up and yield it.
   */
  protected notifyNewEvents(): void {
    const current = this.eventNotifier;
    this.eventNotifier = makeNotifier();
    current.resolve();
  }

  async *stream(): AsyncGenerator<SDKMessage, void> {
    let index = 0;
    while (!this.terminated) {
      while (index < this.script.events.length) {
        yield this.script.events[index++] as SDKMessage;
      }
      if (this.terminated) break;
      await Promise.race([this.eventNotifier.promise, this.terminationPromise]);
    }
    while (index < this.script.events.length) {
      yield this.script.events[index++] as SDKMessage;
    }
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
    this.notifyListener(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected transitionTo(nextStatus: RunStatus): void {
    if (this.terminated) return;
    this.terminated = true;
    this.status = nextStatus;
    this.durationMs = Date.now() - this.startTime;
    if (nextStatus !== "cancelled" && this.script.result !== undefined) {
      this.result = this.script.result;
    }
    this.notifyAllListeners();
    this.eventNotifier.resolve();
    this.resolveTermination(this.buildResult(nextStatus));
  }

  protected buildResult(status: RunStatus): RunResult {
    const base: RunResult = {
      id: this.id,
      status: status === "running" ? "finished" : status,
      ...(this.model !== undefined ? { model: this.model } : {}),
      durationMs: this.durationMs ?? Date.now() - this.startTime,
    };
    if ((status === "finished" || status === "error") && this.script.result !== undefined) {
      base.result = this.script.result;
    }
    // Surface the script's errorDetail (set by emitErrorEvent) so wait()
    // callers see the cause without having to drain stream().
    if (status === "error" && this.script.errorDetail !== undefined) {
      base.error = this.script.errorDetail;
    }
    return this.extendRunResult(applyExtraRunFields(base, this.script));
  }

  /** Subclasses override to attach runtime-specific fields (e.g. cloud git info). */
  protected extendRunResult(result: RunResult): RunResult {
    return result;
  }

  /** Whether `onDidChangeStatus` should fire immediately with the current status. */
  protected notifyImmediately(): boolean {
    return false;
  }

  private notifyListener(listener: (status: RunStatus) => void): void {
    if (!this.notifyImmediately()) return;
    try {
      listener(this.status);
    } catch {
      // listeners are user code; never propagate
    }
  }

  private notifyAllListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch {
        // listeners are user code; never propagate
      }
    }
  }
}

function makeNotifier(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
