import type { ModelSelection } from "./agent.js";
import type { ConversationStep, ConversationTurn } from "./conversation.js";
import type { McpServerConfig } from "./mcp.js";
import type { SDKMessage } from "./messages.js";
import type { InteractionUpdate } from "./updates.js";

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
  | "downloadArtifact";

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
  onStep?: (args: { step: ConversationStep }) => void | Promise<void>;
  onDelta?: (args: { update: InteractionUpdate }) => void | Promise<void>;
  /** Local agents only. Expire a stuck active run before starting this message. */
  local?: { force?: boolean };
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
