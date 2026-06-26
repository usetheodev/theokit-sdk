/**
 * Public compaction / context-management helpers (M2-1, extended V3-3).
 *
 * Promotes the SDK's compaction capability to a public surface so consumers can
 * compact a transcript, mark/filter conversation checkpoints, and detect
 * context-overflow — without reaching into `internal/`.
 *
 * Two recent-window modes (V3-3):
 *  - `keepRecent` (turn-count, default) — keeps the last N turns verbatim and
 *    always preserves leading system PROMPTS; reuses the internal
 *    `selectCompressionWindow` (no second algorithm).
 *  - `keepTokens` (token-budget) — keeps the trailing turns whose accumulated
 *    `estimateTokens` fits the budget (theocode `splitTranscript` semantics). In
 *    this mode leading system prompts are NOT special-cased (D6).
 *
 * Summarization is delegated to a caller-supplied callback (which receives the
 * older window + the summary template). With `failSafe`, a thrown summarizer
 * returns the ORIGINAL transcript + a structured warn (compaction is an
 * optimization, never a cause of data loss); without it, the error propagates.
 *
 * Public from the `@theokit/sdk/compaction` sub-path. See `docs.md → Compaction`.
 */

import { TheokitAgentError } from "./errors.js";
import { selectCompressionWindow } from "./internal/runtime/compression/compression-helpers.js";
import type { CompressibleMessage } from "./internal/runtime/compression/compression-summarizer.js";
import { redactSecrets } from "./internal/security/redact.js";

export type { CompressibleMessage };

/**
 * Sentinel prefix marking a conversation checkpoint turn. A visible, structured,
 * prose-unlikely token (no invisible/control bytes — safe to persist and to read
 * in source). Only {@link buildCheckpoint} should produce content beginning with it.
 */
export const CHECKPOINT_MARKER = "[[theokit:checkpoint]] ";

/**
 * The 7-section summary template handed to the `summarize` callback (theocode
 * parity shape). Every header is always present so the summarizer cannot silently
 * drop a category; the model is told to preserve file paths, commands, and error
 * text verbatim. Override per-call via {@link CompactTranscriptOptions.summaryTemplate}.
 */
export const SUMMARY_TEMPLATE = `Summarize the conversation so far into these sections (keep every header even if empty):

## Goal
What the user is ultimately trying to achieve.

## Constraints
Hard requirements, conventions, and rules stated.

## Progress
What has been done so far.

## Decisions
Choices made and their rationale.

## Next
The immediate next steps.

## Critical
Anything that MUST NOT be forgotten (preserve verbatim: error messages, exact values).

## Files
File paths touched or referenced (verbatim).`;

/** Reject an empty marker — it would match every turn via `startsWith("")` (EC-3). */
function assertMarker(marker: string): void {
  if (marker === "") {
    throw new TheokitAgentError("compaction marker must be non-empty", {
      code: "invalid_argument",
    });
  }
}

/** True for a real system prompt — a `system` turn that is NOT a checkpoint marker. */
function isSystemPrompt(message: CompressibleMessage, marker: string): boolean {
  return message.role === "system" && !message.content.startsWith(marker);
}

/** Carried split: leading system prompts (preserved), the older window, the verbatim tail. */
interface TranscriptSplit {
  systemPrompts: CompressibleMessage[];
  head: CompressibleMessage[];
  recent: CompressibleMessage[];
}

/**
 * Token-budget split (theocode `splitTranscript`): walk from the END accumulating
 * `estimateTokens` until `keepTokens` is exceeded; everything older is the head.
 * Always keeps ≥ 1 recent turn. No system-prompt special-casing (D6).
 */
function selectByTokenBudget(
  messages: CompressibleMessage[],
  keepTokens: number,
): { head: CompressibleMessage[]; recent: CompressibleMessage[] } {
  let acc = 0;
  let splitIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    acc += estimateTokens(messages[i]?.content ?? "");
    if (acc > keepTokens && i < messages.length - 1) {
      splitIndex = i + 1;
      break;
    }
    splitIndex = i;
  }
  return { head: messages.slice(0, splitIndex), recent: messages.slice(splitIndex) };
}

/** Turn-count split (M2): preserve leading system prompts; window the rest by `keepRecent`. */
function splitByRecent(
  messages: CompressibleMessage[],
  keepRecent: number,
  marker: string,
): TranscriptSplit {
  const systemPrompts = messages.filter((m) => isSystemPrompt(m, marker));
  const rest = messages.filter((m) => !isSystemPrompt(m, marker));
  const { toCompress, toPreserve } = selectCompressionWindow(rest, keepRecent);
  return { systemPrompts, head: toCompress, recent: toPreserve };
}

/** Options for {@link compactTranscript}. */
export interface CompactTranscriptOptions {
  /** Trailing turns preserved verbatim by COUNT (default 6). Ignored when `keepTokens` is set. */
  keepRecent?: number;
  /**
   * Trailing turns preserved verbatim by TOKEN BUDGET (theocode mode). When set,
   * takes precedence over `keepRecent` and disables system-prompt preservation (D6).
   */
  keepTokens?: number;
  /** Checkpoint marker (default {@link CHECKPOINT_MARKER}). Must be non-empty. */
  marker?: string;
  /** Summary template passed to `summarize` (default {@link SUMMARY_TEMPLATE}). */
  summaryTemplate?: string;
  /** Summarize the older window into one turn; if omitted, the older window is dropped. */
  summarize?: (older: CompressibleMessage[], template: string) => Promise<CompressibleMessage>;
  /**
   * When true, a thrown `summarize` returns the ORIGINAL transcript + a structured
   * warn (compaction never loses data). Default false: the error propagates.
   */
  failSafe?: boolean;
}

/** Sentinel returned by {@link runSummarize} when fail-safe swallowed a throw. */
const FAILSAFE_ABORT = Symbol("failsafe-abort");

/** Run the summarizer; on throw, either propagate or (fail-safe) warn + signal abort. */
async function runSummarize(
  summarize: NonNullable<CompactTranscriptOptions["summarize"]>,
  head: CompressibleMessage[],
  template: string,
  failSafe: boolean,
): Promise<CompressibleMessage | typeof FAILSAFE_ABORT> {
  try {
    return await summarize(head, template);
  } catch (err) {
    if (!failSafe) throw err;
    // Unbreakable Rule 8 — never fail silently. The breadcrumb points at the root
    // cause when a summarizer fails every turn and context grows unchecked. The
    // summarizer is caller-supplied, so its error text is routed through
    // `redactSecrets` (ADR D68 — no unredacted output sink in src/).
    console.warn(
      `[compaction] summarizer failed — proceeding uncompacted: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
    );
    return FAILSAFE_ABORT;
  }
}

/**
 * Compact a transcript. In `keepRecent` mode (default) the last `keepRecent` turns
 * are kept verbatim and leading system PROMPTS preserved; in `keepTokens` mode the
 * trailing turns within the token budget are kept (no system special-casing, D6).
 * The older window is summarized (via `summarize`, receiving the template) or
 * dropped. Never mutates the input.
 */
export async function compactTranscript(
  messages: CompressibleMessage[],
  options: CompactTranscriptOptions = {},
): Promise<CompressibleMessage[]> {
  const marker = options.marker ?? CHECKPOINT_MARKER;
  assertMarker(marker);
  const split =
    options.keepTokens != null
      ? { systemPrompts: [], ...selectByTokenBudget(messages, options.keepTokens) }
      : splitByRecent(messages, options.keepRecent ?? 6, marker);
  if (split.head.length === 0) {
    return [...messages];
  }
  if (!options.summarize) {
    return [...split.systemPrompts, ...split.recent];
  }
  const template = options.summaryTemplate ?? SUMMARY_TEMPLATE;
  const summary = await runSummarize(
    options.summarize,
    split.head,
    template,
    options.failSafe ?? false,
  );
  if (summary === FAILSAFE_ABORT) {
    return [...messages];
  }
  return [...split.systemPrompts, summary, ...split.recent];
}

/**
 * Build a checkpoint marker turn (a `system` turn whose content starts with
 * `marker`, default {@link CHECKPOINT_MARKER}). `marker` must be non-empty.
 */
export function buildCheckpoint(
  label?: string,
  marker: string = CHECKPOINT_MARKER,
): CompressibleMessage {
  assertMarker(marker);
  return { role: "system", content: marker + (label ?? "") };
}

/** Options for {@link filterFromLatestCheckpoint}. */
export interface FilterCheckpointOptions {
  /** Marker to scan for (default {@link CHECKPOINT_MARKER}). */
  marker?: string;
  /**
   * `'after'` (default, M2) returns turns AFTER the latest marker (exclusive);
   * `'from'` (theocode) returns turns FROM the latest marker (inclusive).
   */
  include?: "after" | "from";
}

/**
 * Return the turns relative to the most recent checkpoint marker (all turns if
 * none). `include: 'after'` (default) excludes the checkpoint; `'from'` includes
 * it (the summary stands in for the pruned head). Never mutates the input.
 */
export function filterFromLatestCheckpoint(
  messages: CompressibleMessage[],
  options: FilterCheckpointOptions = {},
): CompressibleMessage[] {
  const marker = options.marker ?? CHECKPOINT_MARKER;
  const offset = options.include === "from" ? 0 : 1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.content.startsWith(marker)) {
      return messages.slice(i + offset);
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
