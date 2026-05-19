/**
 * Strip `<think>...</think>` chain-of-thought blocks (T1.2, ADR D96).
 *
 * DeepSeek-R1, Qwen-QwQ, and similar reasoning models emit visible
 * `<think>` blocks in the `content` field. Without stripping, they enter
 * the message history; each turn accumulates 5k+ thinking tokens, and
 * prompt caching invalidates every turn (Hermes v0.2 #174, ~10x cost
 * regression).
 *
 * NOTE on `<think>` in legitimate prose (EC-10): a user/assistant message
 * that deliberately contains the `<think>` token will lose it. This is
 * provider-convention scope — `<think>` is reserved for CoT, never plain
 * content.
 *
 * @internal
 */

const THINK_PATTERN = /<think>[\s\S]*?<\/think>\s*/g;

export interface ThinkStripResult {
  /** Content with `<think>` blocks removed. */
  visible: string;
  /** Combined thinking text (without `<think>` tags), or null if none. */
  thinking: string | null;
}

/**
 * Extract `<think>...</think>` blocks from content. Returns visible text
 * (for history persistence) and concatenated thinking (for opt-in display).
 *
 * Unclosed `<think>` blocks (no matching `</think>`) are PRESERVED in
 * visible — fail-open semantics so corrupted provider streams don't
 * accidentally strip everything.
 *
 * @internal
 */
export function stripThinkBlocks(content: string): ThinkStripResult {
  const matches = [...content.matchAll(THINK_PATTERN)];
  const thinking =
    matches.length > 0
      ? matches
          .map((m) => m[0])
          .join("\n")
          .replace(/<\/?think>/g, "")
          .trim()
      : null;
  const visible = content.replace(THINK_PATTERN, "").trim();
  return { visible, thinking };
}
