/**
 * Owner: `internal/runtime/lifecycle/` (1 of 1 importers). Derived from the import graph, not
 * declared — `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * Fork primitive public type contracts (T1.2, ADRs D110-D114).
 *
 * Extracted into a leaf type module (arch-review ADR 0001) so the public
 * `types/agent.ts` barrel can reference `ForkOptions`/`ForkResult` without
 * importing the `internal/runtime/lifecycle/fork-agent.ts` implementation — which in
 * turn imports back from `types/agent.ts`. That mutual reference created a
 * type-only `madge` cycle. These interfaces are self-contained (no SDKAgent
 * / AgentOptions references), so co-locating them here breaks the cycle with
 * no runtime change. `fork-agent.ts` re-exports them for back-compat.
 */

/**
 * Caller-supplied fork configuration. See `forkAgentImpl`.
 *
 * @public
 */
export interface ForkOptions {
  /**
   * Tool subset visible to the fork. Names must match the canonical (post-repair)
   * tool name — typically lowercase. Tools not in this set return a `tool_result`
   * with `"Tool blocked by fork whitelist"` content (EC-H).
   */
  allowedTools: Set<string>;
  /** Task prompt sent to the fork. */
  prompt: string;
  /** Override system prompt. Default: byte-identical inheritance from parent (D112). */
  systemPrompt?: string;
  /** Memory write provenance tag (D114). Default `"fork"`. */
  forkOrigin?: string;
}

/**
 * Outcome of a fork run.
 *
 * @public
 */
export interface ForkResult {
  /** Final agent response text (`undefined` when the fork produced no result). */
  result: string | undefined;
  /** Tool calls executed inside the fork. */
  toolCalls: ReadonlyArray<{ name: string; input: Record<string, unknown> }>;
  /** Aggregate token usage reported by the run. */
  usage: { inputTokens: number; outputTokens: number };
}
