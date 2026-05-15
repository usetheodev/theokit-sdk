/**
 * Context manager backend.
 *
 * - `"file"` — Read `.theokit/context.json` from the workspace (local) or the
 *   cloned repo (cloud).
 *
 * @public
 */
export type ContextManagerKind = "file";

/**
 * Context configuration accepted by `Agent.create()` via {@link AgentOptions.context}.
 *
 * @public
 */
export interface ContextSettings {
  /** Which backend reads context. Defaults to `"file"`. */
  manager?: ContextManagerKind;
  /** Hard cap on tokens emitted into the agent's system prompt. */
  maxTokens?: number;
}

/**
 * Inclusion state of a single context source in a {@link ContextSnapshot}.
 *
 * @public
 */
export type ContextSourceStatus = "included" | "excluded" | "summarized";

/**
 * A single context source resolved by the context manager.
 *
 * @public
 */
export interface ContextSource {
  /** Stable identifier — usually the filename without extension. */
  name: string;
  /** Path relative to the workspace root, when applicable. */
  path?: string;
  /** Whether the source was included, dropped, or summarized to fit the budget. */
  status: ContextSourceStatus;
  /** Free-text reason when `status !== "included"`. */
  reason?: string;
}

/**
 * Token budget used by the context manager for a single agent.
 *
 * @public
 */
export interface ContextBudget {
  maxTokens?: number;
  /**
   * Either a token count or a list of token strings extracted from source
   * content. Normalized to `<tokens>` in golden comparisons.
   */
  usedTokens?: number | string[];
}

/**
 * Result of `agent.context.snapshot()`. Public and secret-free by design — safe
 * to log and persist. Raw secrets, local absolute paths, and exact token values
 * are never present.
 *
 * @public
 */
export interface ContextSnapshot {
  runtime: "local" | "cloud";
  sources: ContextSource[];
  budget?: ContextBudget;
}

/**
 * Public context manager handle exposed as `agent.context`.
 *
 * @public
 */
export interface SDKContextManager {
  /** Inspect what the context manager actually loaded for the agent. */
  snapshot(): Promise<ContextSnapshot>;
}
