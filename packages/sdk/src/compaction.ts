/**
 * Public compaction / context-management helpers (M2-1).
 *
 * Promotes the SDK's compaction capability to a public surface so consumers can
 * compact a transcript (keep-recent + optional summarize), mark/filter
 * conversation checkpoints, and detect context-overflow — without reaching into
 * `internal/`. `compactTranscript` REUSES the internal `selectCompressionWindow`
 * (no second algorithm); summarization is delegated to a caller-supplied callback
 * (which can wire the internal `compressConversationWindow`).
 *
 * Public from the `@theokit/sdk/compaction` sub-path. See `docs.md → Compaction`.
 */

import { TheokitAgentError } from "./errors.js";
import { selectCompressionWindow } from "./internal/runtime/compression/compression-helpers.js";
import type { CompressibleMessage } from "./internal/runtime/compression/compression-summarizer.js";

export type { CompressibleMessage };

/**
 * Sentinel prefix marking a conversation checkpoint turn. A visible, structured,
 * prose-unlikely token (no invisible/control bytes — safe to persist and to read
 * in source). Only {@link buildCheckpoint} should produce content beginning with it.
 */
export const CHECKPOINT_MARKER = "[[theokit:checkpoint]] ";

/** True for a real system prompt — a `system` turn that is NOT a checkpoint marker. */
function isSystemPrompt(message: CompressibleMessage): boolean {
  return message.role === "system" && !message.content.startsWith(CHECKPOINT_MARKER);
}

/** Options for {@link compactTranscript}. */
export interface CompactTranscriptOptions {
  /** Trailing turns preserved verbatim (default 6, matching the internal window). */
  keepRecent?: number;
  /** Summarize the older window into one turn; if omitted, the older window is dropped. */
  summarize?: (older: CompressibleMessage[]) => Promise<CompressibleMessage>;
}

/**
 * Compact a transcript: keep the last `keepRecent` turns verbatim, always preserve
 * leading system PROMPTS, and either summarize (via `summarize`) or drop the older
 * window. Checkpoint markers are NOT system prompts — they flow through the
 * keep-recent window as ordinary turns (a marker in the older window is
 * summarized/dropped, one in the recent window is kept). Reuses the internal
 * `selectCompressionWindow`. Never mutates the input.
 */
export async function compactTranscript(
  messages: CompressibleMessage[],
  options: CompactTranscriptOptions = {},
): Promise<CompressibleMessage[]> {
  const keepRecent = options.keepRecent ?? 6;
  const systemPrompts = messages.filter(isSystemPrompt);
  const rest = messages.filter((m) => !isSystemPrompt(m));
  const { toCompress, toPreserve } = selectCompressionWindow(rest, keepRecent);
  if (toCompress.length === 0) {
    return [...messages];
  }
  if (options.summarize) {
    const summary = await options.summarize(toCompress);
    return [...systemPrompts, summary, ...toPreserve];
  }
  return [...systemPrompts, ...toPreserve];
}

/** Build a checkpoint marker turn (a `system` turn whose content starts with {@link CHECKPOINT_MARKER}). */
export function buildCheckpoint(label?: string): CompressibleMessage {
  return { role: "system", content: CHECKPOINT_MARKER + (label ?? "") };
}

/**
 * Return the turns AFTER the most recent checkpoint marker (all turns if none).
 * Scans backward for the latest marker. Never mutates the input.
 */
export function filterFromLatestCheckpoint(messages: CompressibleMessage[]): CompressibleMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.content.startsWith(CHECKPOINT_MARKER)) {
      return messages.slice(i + 1);
    }
  }
  return [...messages];
}

/**
 * True iff `err` is a {@link TheokitAgentError} (or subclass) reporting a
 * context-window-exceeded condition (the typed `context_too_long` code). Reads
 * both `code` (set by provider mappers) and `metadata.code` (the preferred field)
 * — never a brittle message regex.
 */
export function isContextOverflowError(err: unknown): boolean {
  return (
    err instanceof TheokitAgentError &&
    (err.code === "context_too_long" || err.metadata?.code === "context_too_long")
  );
}

/** Input to {@link shouldCompact}: an estimate, the model's window, and reserved headroom. */
export interface ShouldCompactInput {
  /** Estimated token count of the next request (e.g. from {@link estimateTokens}). */
  readonly estimated: number;
  /** The model's total context window, in tokens. */
  readonly contextWindow: number;
  /** Tokens to reserve as headroom (output + safety margin). */
  readonly buffer: number;
}

/**
 * Tokenizer-free token estimate via the conventional ~4-chars-per-token
 * heuristic: `ceil(text.length / 4)`. `""` → 0; any non-empty text → ≥ 1.
 * A cheap PRE-CALL gate for {@link shouldCompact} — NOT exact tokenization
 * (a consumer needing exactness supplies their own tokenizer). Uses UTF-16
 * `.length` (code units), so multibyte text is approximate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Decide BEFORE sending whether to compact: `true` when the `estimated` token
 * count leaves less than `buffer` headroom in the `contextWindow`
 * (`estimated >= contextWindow - buffer`). A `buffer >= contextWindow`
 * (non-positive threshold) always returns `true`. Pure — the caller supplies
 * the window (e.g. from `resolveModelCapabilities`), keeping this decoupled
 * from the per-model catalog.
 */
export function shouldCompact(input: ShouldCompactInput): boolean {
  return input.estimated >= input.contextWindow - input.buffer;
}
