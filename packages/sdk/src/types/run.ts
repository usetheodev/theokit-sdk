// T4.1 / D438 — import primitives from leaf to break the run<->agent cycle (#5).
import type { CustomTool, ModelSelection } from "./agent-prims.js";
import type { ConversationStep, ConversationTurn } from "./conversation.js";
import type { McpServerConfig } from "./mcp.js";
import type { SDKMessage } from "./messages.js";
import type { InteractionUpdate } from "./updates.js";
import type { CostBreakdown, TokenUsage } from "./usage.js";

/**
 * Lifecycle status of a {@link Run}.
 *
 * @public
 */
export type RunStatus = "running" | "finished" | "error" | "cancelled";

/**
 * Operations that may or may not be supported on a given {@link Run}, or on
 * its parent agent.
 *
 * Runtime-specific availability — query at runtime with `run.supports(op)` and
 * read the human reason via `run.unsupportedReason(op)`.
 *
 * @public
 */
export type RunOperation =
  | "stream"
  | "wait"
  | "cancel"
  | "conversation"
  | "listArtifacts"
  | "downloadArtifact"
  | "runUntil"
  | "runToCompletion"
  | "fork"
  | "usePersonality"
  | "workflow";

/**
 * Git metadata attached to cloud runs.
 *
 * @public
 */
export interface RunGitInfo {
  branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }>;
}

/**
 * Terminal result of a {@link Run}.
 *
 * @public
 */
export interface RunResult {
  id: string;
  status: "finished" | "error" | "cancelled";
  result?: string;
  model?: ModelSelection;
  durationMs?: number;
  git?: RunGitInfo;
  /**
   * Structured error detail, populated when `status === "error"`. Surfaces
   * the diagnostic that emit-error-event pushes into the stream so callers
   * that don't drain `run.stream()` still get the cause via `run.wait()`.
   *
   * For successful runs (`status: "finished"`) this is undefined.
   *
   * @public
   */
  error?: RunErrorDetail;
  /**
   * Token usage observed for this run (ADR D376). Populated in every
   * status where ≥1 LLM call completed — including partial-failure
   * runs (EC-5). `undefined` only when zero LLM calls executed (e.g.,
   * abort before send).
   *
   * @public
   */
  usage?: TokenUsage;
  /**
   * Estimated/actual USD cost for this run (ADR D377). Always paired
   * with `usage` when populated. `cost.status` tells caller how to
   * trust the figure.
   *
   * @public
   */
  cost?: CostBreakdown;
  /**
   * M1-2: `true` when the run stopped because the agent loop hit its iteration
   * ceiling (`SendOptions.maxIterations` or the default of 8) while the model
   * still wanted to call tools — i.e. the work was silently truncated rather
   * than finished. `undefined`/absent on a clean finish. A continuation driver
   * (or a careful caller) inspects this to decide whether to send again.
   *
   * @public
   */
  stoppedAtIterationLimit?: boolean;
}

/**
 * Options for {@link SDKAgent.runToCompletion} (M1 Phase 3 — continuation driver).
 *
 * @public
 */
export interface RunToCompletionOptions {
  /**
   * Maximum number of continuation rounds (re-sends) before giving up with
   * `terminal: "step_limit"`. Default 5. A hard ceiling that prevents a
   * runaway loop when the model keeps truncating.
   */
  maxRounds?: number;
  /**
   * The short prompt re-sent after a truncated round to make the (stateful)
   * agent resume. Defaults to a generic "continue" instruction. The original
   * conversation is preserved by the agent's session, so this need not repeat
   * the task.
   */
  continuationPrompt?: string;
  /** Called once per truncated round that triggers a re-send (for metrics/logging). */
  onTruncated?: (event: { round: number }) => void | Promise<void>;
  /** Abort signal; checked between rounds — once aborted, no further round starts. */
  signal?: AbortSignal;
  /** Per-send options forwarded to each underlying `send()` (e.g. `maxIterations`). */
  sendOptions?: SendOptions;
}

/**
 * Result of {@link SDKAgent.runToCompletion}.
 *
 * @public
 */
export interface RunToCompletionResult {
  /**
   * Why the driver stopped:
   * - `"done"` — a round finished without truncating (the model is done).
   * - `"step_limit"` — `maxRounds` exhausted (or aborted) while still truncating.
   * - `"no_progress"` — two consecutive rounds produced empty output.
   */
  terminal: "done" | "step_limit" | "no_progress";
  /**
   * Index of the final round. Round 0 is the initial `send`; rounds ≥ 1 are
   * continuation re-sends. So `terminal: "done"` with `rounds: 0` means the
   * first send finished without truncating; `rounds: N` means N continuation
   * re-sends happened. For `step_limit`, `rounds` equals `maxRounds`.
   */
  rounds: number;
  /** The `RunResult` of the final round. */
  lastResult: RunResult;
  /** Token usage summed across all rounds; `undefined` when no round reported usage. */
  usage?: TokenUsage;
}

/**
 * Structured error attached to a {@link RunResult} when the underlying run
 * transitioned to `"error"` status. `message` is always present; `code` is
 * a stable identifier suitable for branching (e.g. `"llm_4xx"`,
 * `"tool_dispatch_failed"`, `"mcp_init_failed"`); `cause` is the raw error
 * for further inspection when available.
 *
 * @public
 */
export interface RunErrorDetail {
  message: string;
  code?: string;
  cause?: unknown;
}

/**
 * Dimensions of an inline image attachment.
 *
 * @public
 */
export interface SDKImageDimension {
  width: number;
  height: number;
}

/**
 * Either a remote URL or inline base64 payload.
 *
 * @public
 */
export type SDKImage =
  | { url: string; dimension?: SDKImageDimension }
  | { data: string; mimeType: string; dimension?: SDKImageDimension };

/**
 * Structured form of `agent.send()`'s message argument. Use it to send images
 * alongside text.
 *
 * @public
 */
export interface SDKUserMessage {
  text: string;
  images?: SDKImage[];
}

/**
 * Per-send overrides and callbacks.
 *
 * @public
 */
export interface SendOptions {
  model?: ModelSelection;
  /**
   * Per-call system prompt override. Wins over `AgentOptions.systemPrompt`.
   * String only — for dynamic resolvers, configure on `AgentOptions`. An
   * empty string is honoured (it explicitly clears the system context).
   */
  systemPrompt?: string;
  /** Fully replaces creation-time servers for this run (not merged). */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Per-call inline custom tools. Fully replaces `AgentOptions.tools` for
   * this run (not merged). Local runtime only — cloud agents reject any
   * non-empty per-call tools array with the same error code as creation
   * (`cloud_custom_tools_rejected`). Semantics:
   * - `undefined` → fall back to `AgentOptions.tools`
   * - `[]` → explicitly clear (no custom tools for this run)
   * - `[t1, t2]` → use exactly these tools for this run
   */
  tools?: CustomTool[];
  onStep?: (args: { step: ConversationStep }) => void | Promise<void>;
  onDelta?: (args: { update: InteractionUpdate }) => void | Promise<void>;
  /** Local agents only. Expire a stuck active run before starting this message. */
  local?: { force?: boolean };
  /**
   * Optional `AbortSignal` propagated to memory adapter `pre_user_send`
   * hooks (EC-H). Note: the LLM HTTP call itself is NOT cancellable
   * mid-stream — same constraint as `Agent.batch` (ADR D140).
   *
   * @public
   */
  signal?: AbortSignal;
  /**
   * Opt-in task wrapping (ADRs D363, D374). When truthy, the entire
   * run is registered as a `Task` in the SDK's observable registry —
   * caller can list / inspect / cancel / subscribe via the `Task`
   * namespace. Default behavior (no `task` option) is byte-identical
   * to v1.1 (no Task overhead).
   *
   * Accepts:
   * - `true` — auto-generate task id; no extra metadata.
   * - `{ id, meta }` — user-supplied id (D368 grammar enforced) and/or
   *   metadata attached to the handle's `meta` field.
   *
   * The work-fn `signal` is **merged** with `options.signal` (whichever
   * aborts first wins). Local agents only — CloudAgent throws
   * `UnsupportedTaskOperationError` (D370).
   *
   * @public
   */
  task?: true | { id?: string; meta?: Record<string, unknown> };
  /**
   * Per-send ceiling on the agent loop's tool-calling turns (M1-2). Raises (or
   * lowers) the default cap of 8 for this single send — useful when one heavy
   * task needs more rounds than the agent's default. Must be a positive
   * integer; invalid values throw `ConfigurationError` at the boundary. When
   * unset, the loop uses the default of 8.
   *
   * @public
   */
  maxIterations?: number;
}

/**
 * Handle to a single prompt submission.
 *
 * @public
 */
export interface Run {
  readonly id: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly result?: string;
  readonly model?: ModelSelection;
  readonly durationMs?: number;
  readonly git?: RunGitInfo;
  readonly createdAt?: number;
  /** AsyncGenerator of normalized stream events. Discriminate on `event.type`. */
  stream(): AsyncGenerator<SDKMessage, void>;
  /** Resolves to the terminal {@link RunResult}. */
  wait(): Promise<RunResult>;
  /** Move status to `"cancelled"`, abort the stream, stop in-flight tool calls. */
  cancel(): Promise<void>;
  /** Structured per-turn view of the conversation. */
  conversation(): Promise<ConversationTurn[]>;
  /** Whether the given operation is available on this run's runtime. */
  supports(operation: RunOperation): boolean;
  /** Human-readable reason that `supports(operation)` returned `false`. */
  unsupportedReason(operation: RunOperation): string | undefined;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onDidChangeStatus(listener: (status: RunStatus) => void): () => void;
}
