/**
 * Stateless continuation-history rebuild (M1-3 — plan m1-continuation-history).
 *
 * `buildReplayHistory` serializes `SDKMessage[]` stream events into a bounded
 * `StoredMessage[]` replay history for the STATELESS continuation path: a server
 * (or serverless handler) that re-runs an agent on a fresh request reconstructs
 * the working memory from persisted events rather than a live session. The
 * replayed history is the ONLY working memory the continued model has, so it
 * MUST carry tool-result content and be bounded against the context window.
 *
 * Complements M1 Phase 3 `runToCompletion` (the STATEFUL path, where the session
 * preserves history). Pure, sync, dependency-free; reuses the SDK's own
 * `truncateWithMarker` for per-item caps (Rule 9). Design: blueprint
 * `m1-continuation-history` ADRs D1-D5; first-party baseline
 * `theocode/server/lib/continuation-history.ts`.
 *
 * @public
 */

import type { StoredMessage } from "../../../types/conversation-storage.js";
import type { SDKMessage } from "../../../types/messages.js";
import { truncateWithMarker } from "./context-loaders.js";

/** ~4 characters per token — an APPROXIMATION (ADK-JS / theocode), not exact tokenization. */
const CHARS_PER_TOKEN = 4;
/** Tokens reserved for system prompt + continuation prompt + the model's reply. */
const DEFAULT_RESERVE_TOKENS = 8000;

/**
 * Options for {@link buildReplayHistory}.
 *
 * @public
 */
export interface ReplayHistoryOptions {
  /** The continued model's context window, in tokens. Drives the char budget. */
  contextWindowTokens: number;
  /** Tokens held back for system + continuation prompt + reply. Default 8000. */
  reserveTokens?: number;
  /**
   * Max characters for a single oversized turn before it is truncated (never
   * dropped). Default `floor(budgetChars / 2)`. Guarded to ≥ 0.
   */
  perItemCap?: number;
}

/** A replay turn plus the `call_id` that pairs a tool_call with its tool_result. */
interface ReplayTurn {
  message: StoredMessage;
  /** `call_id` for tool turns; undefined for assistant/base turns. */
  pairId?: string;
}

/** Finite number or fallback (EC-1: a non-finite budget input must never poison the math). */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Char budget derived from the context window (ADR D5). */
function charBudget(options: ReplayHistoryOptions): number {
  const window = finiteOr(options.contextWindowTokens, 0);
  const reserve = finiteOr(options.reserveTokens ?? DEFAULT_RESERVE_TOKENS, DEFAULT_RESERVE_TOKENS);
  return Math.max(0, window - reserve) * CHARS_PER_TOKEN;
}

/** Extract concatenated text from an assistant message's text blocks (ignores tool_use). */
function assistantText(event: Extract<SDKMessage, { type: "assistant" }>): string {
  return event.message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Stringify a tool payload (args/result) without ever emitting the literal "undefined" (EC-4). */
function stringifyPayload(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/** Apply the per-item truncation cap, reusing the SDK's marker truncation (Rule 9). */
function cap(content: string, perItemCap: number): string {
  return truncateWithMarker(content, Math.max(0, perItemCap)).finalContent;
}

/**
 * Map one stream event to a replay turn, or `null` when it is not replayable
 * (ADR D2). Tool events are collapsed by status: `running` → `tool_call` (args),
 * `completed`/`error` → `tool_result` (result content), both carrying `call_id`
 * so the trim step can keep the pair together. Per-item truncation is applied
 * here so one giant result cannot blow the whole budget.
 */
function mapEvent(event: SDKMessage, perItemCap: number): ReplayTurn | null {
  if (event.type === "assistant") {
    const text = assistantText(event);
    return text.length > 0
      ? { message: { role: "assistant", content: cap(text, perItemCap) } }
      : null;
  }
  if (event.type === "tool_call") {
    if (event.status === "running") {
      const content = cap(`[tool_call ${event.name}] ${stringifyPayload(event.args)}`, perItemCap);
      return { message: { role: "tool_call", content }, pairId: event.call_id };
    }
    const content = cap(
      `[tool_result ${event.name}] ${stringifyPayload(event.result)}`,
      perItemCap,
    );
    return { message: { role: "tool_result", content }, pairId: event.call_id };
  }
  return null;
}

/**
 * Indices to evict when dropping `turns[0]` (ADR D3 tool-pair safety): the turn
 * itself plus every other turn sharing its `call_id`, so a `tool_call` and its
 * `tool_result` are never split — robust to non-adjacent / interleaved calls.
 */
function evictionIndices(turns: ReplayTurn[]): number[] {
  const head = turns[0];
  if (head?.pairId === undefined) return [0];
  const indices: number[] = [];
  for (let i = 0; i < turns.length; i += 1) {
    if (turns[i]?.pairId === head.pairId) indices.push(i);
  }
  return indices;
}

/** Total content length across turns. */
function totalChars(turns: ReplayTurn[]): number {
  return turns.reduce((n, t) => n + t.message.content.length, 0);
}

/** Drop oldest turns (pair-safe by call_id) until total ≤ budget; keep ≥ 1 (ADR D3). */
function trimToBudget(turns: ReplayTurn[], budgetChars: number): ReplayTurn[] {
  const kept = [...turns];
  while (kept.length > 1 && totalChars(kept) > budgetChars) {
    const evict = evictionIndices(kept);
    // Keep ≥ 1: never evict the whole remainder (a lone over-budget pair stays atomic).
    if (kept.length - evict.length < 1) break;
    for (const idx of evict.sort((a, b) => b - a)) kept.splice(idx, 1);
  }
  return kept;
}

/**
 * Rebuild a bounded replay history from `base` (prior durable turns) plus the
 * `events` of the latest round. Returns a NEW array; never mutates inputs.
 *
 * @public
 */
export function buildReplayHistory(
  base: readonly StoredMessage[],
  events: readonly SDKMessage[],
  options: ReplayHistoryOptions,
): StoredMessage[] {
  const budgetChars = charBudget(options);
  const perItemCap = Math.max(0, options.perItemCap ?? Math.floor(budgetChars / 2));
  const turns: ReplayTurn[] = base.map((message) => ({ message }));
  for (const event of events) {
    const turn = mapEvent(event, perItemCap);
    if (turn !== null) turns.push(turn);
  }
  return trimToBudget(turns, budgetChars).map((t) => t.message);
}
