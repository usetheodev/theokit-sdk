/**
 * Owner: `src/` (1 of 1 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * Public types for ShareGPT trajectory export (ADR D139).
 *
 * Output format for fine-tuning datasets — consumed by HuggingFace, Axolotl,
 * LLaMA-Factory, and most modern fine-tuning toolchains. Pure data shape;
 * no runtime dependency.
 *
 * @public
 */

/**
 * One ShareGPT message in a conversation. `from` identifies the role and
 * `value` carries the textual content. Tool calls live in `tool_calls`
 * (assistant-only) and tool results re-enter as `from: "tool"` entries.
 *
 * @public
 */
export interface ShareGptMessage {
  /** "human" for user, "gpt" for assistant, "tool" for tool result, "system" for system. */
  from: "human" | "gpt" | "tool" | "system";
  /** The message text. Empty string is valid (preserves turn boundary). */
  value: string;
  /** Optional tool calls — only emitted when `from === "gpt"`. */
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

/**
 * One full ShareGPT-format trajectory — a single conversation plus
 * metadata. JSONL-friendly (one trajectory per line when serialized).
 *
 * @public
 */
export interface ShareGptTrajectory {
  conversations: ShareGptMessage[];
  metadata?: {
    model?: string;
    timestamp: string;
    durationMs: number;
    promptIndex: number;
  };
  /** `true` when the source `BatchResult.ok === true`. Always `true` in current shape. */
  completed: boolean;
  /** Token usage when surfaced by the underlying RunResult (provider-specific). */
  usage?: { inputTokens: number; outputTokens: number };
}
