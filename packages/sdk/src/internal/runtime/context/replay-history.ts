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

/** ~4 characters per token — the field-validated heuristic (peer-js, theocode). */
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

/**
 * Map one stream event to a replay turn, or `null` when it is not replayable
 * (ADR D2). Tool events are collapsed by status: `running` → `tool_call` (args),
 * `completed`/`error` → `tool_result` (result content). Per-item truncation is
 * applied here so one giant result cannot blow the whole budget.
 */
function mapEvent(event: SDKMessage, perItemCap: number): StoredMessage | null {
  if (event.type === "assistant") {
    const text = assistantText(event);
    return text.length > 0 ? { role: "assistant", content: cap(text, perItemCap) } : null;
  }
  if (event.type === "tool_call") {
    if (event.status === "running") {
      return {
        role: "tool_call",
        content: cap(`[tool_call ${event.name}] ${stringifyPayload(event.args)}`, perItemCap),
      };
    }
    return {
      role: "tool_result",
      content: cap(`[tool_result ${event.name}] ${stringifyPayload(event.result)}`, perItemCap),
    };
  }
  return null;
}

/** Apply the per-item truncation cap, reusing the SDK's marker truncation (Rule 9). */
function cap(content: string, perItemCap: number): string {
  return truncateWithMarker(content, Math.max(0, perItemCap)).finalContent;
}

/** True when dropping `messages[0]` would orphan a tool pair that must stay together (ADR D3). */
function dropCountAt0(messages: StoredMessage[]): number {
  // A tool_call immediately followed by its tool_result must be dropped as a pair.
  if (messages[0]?.role === "tool_call" && messages[1]?.role === "tool_result") return 2;
  return 1;
}

/** Drop oldest turns (pair-safe) until total content ≤ budget; keep ≥ 1 (ADR D3). */
function trimToBudget(messages: StoredMessage[], budgetChars: number): StoredMessage[] {
  const kept = [...messages];
  let total = kept.reduce((n, m) => n + m.content.length, 0);
  while (kept.length > 1 && total > budgetChars) {
    const drop = dropCountAt0(kept);
    const removed = kept.splice(0, drop);
    total -= removed.reduce((n, m) => n + m.content.length, 0);
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
  const turns: StoredMessage[] = [];
  for (const event of events) {
    const turn = mapEvent(event, perItemCap);
    if (turn !== null) turns.push(turn);
  }
  return trimToBudget([...base, ...turns], budgetChars);
}
