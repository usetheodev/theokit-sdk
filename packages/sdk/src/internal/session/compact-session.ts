/**
 * M50 (agent-builder) — session-transcript compaction, Codex-faithful.
 *
 * Mirrors the vendored Codex mechanism (`upstream/core/src/compact.rs`):
 *   - the replacement history = recent USER messages verbatim (newest→oldest under a token budget;
 *     prior summaries filtered by marker) + ONE summary message with a textual marker prefix,
 *     injected as `role:"user"` (`build_compacted_history`, compact.rs:589-663);
 *   - persistence is APPEND-ONLY: a `compact_boundary` record becomes the new DAG root and the
 *     replacement messages are chained onto it — resume replays boundary→replacement→suffix
 *     (equivalent of `CompactedItem.replacement_history`, rollout is never truncated);
 *   - a failing summarizer leaves the transcript UNTOUCHED (typed error; no partial state).
 *
 * The summarizer is dependency-injected: tests pass a deterministic fake; the public
 * `Agent.compact` wires the ADR-D440 compression summarizer (its first real caller).
 */

import { type CompressibleMessage, estimateTokens } from "../../compaction.js";
import type { SessionStore } from "../../types/session-store.js";
import { reconstructMessages, SessionTranscript } from "../persistence/session-transcript.js";

/** Textual marker prefixing every compact summary (Codex `SUMMARY_PREFIX` analog). */
export const COMPACT_SUMMARY_MARKER = "[[theokit:compact-summary]]";

/** Budget of VERBATIM user messages preserved in the replacement (Codex `COMPACT_USER_MESSAGE_MAX_TOKENS`). */
export const COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000;

export interface CompactLocation {
  cwd: string;
  agentId: string;
  model?: string;
}

export interface CompactResult {
  preTokens: number;
  postTokens: number;
}

/** Is this message a summary produced by a PRIOR compaction? (filtered from verbatim preservation). */
export function isCompactSummary(content: string): boolean {
  return content.startsWith(COMPACT_SUMMARY_MARKER);
}

/**
 * Extract the text of an LlmMessage: content is `LlmContentPart[]` — concatenate the `text` parts
 * (tool_call / tool_result / image parts are skipped for compaction purposes).
 */
function plainText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter((p): p is { type: string; text: string } =>
      p !== null && typeof p === "object" && (p as { type?: unknown }).type === "text" &&
      typeof (p as { text?: unknown }).text === "string")
    .map((p) => p.text);
  return texts.length > 0 ? texts.join("\n") : undefined;
}

/**
 * Compact one session transcript: summarize the reconstructed history, then append (append-only)
 * a `compact_boundary` + the replacement chain (recent user messages verbatim + marker'd summary).
 *
 * @throws whatever `summarize` throws — with the transcript guaranteed untouched.
 */
export async function compactSessionTranscript(opts: {
  store: SessionStore;
  loc: CompactLocation;
  sessionId: string;
  trigger: "manual" | "auto";
  summarize: (messages: readonly CompressibleMessage[]) => Promise<string>;
}): Promise<CompactResult> {
  const prior = await opts.store.readRecords(opts.loc.agentId);
  const history = reconstructMessages(prior);

  const compressible: CompressibleMessage[] = [];
  for (const m of history) {
    const text = plainText(m.content);
    if (text !== undefined && (m.role === "user" || m.role === "assistant" || m.role === "system")) {
      compressible.push({ role: m.role, content: text });
    }
  }
  const preTokens = estimateTokens(compressible.map((m) => m.content).join("\n"));

  // Summarize FIRST — a throwing summarizer must leave the transcript untouched (fail-safe).
  const summaryBody = await opts.summarize(compressible);

  // Recent user messages verbatim: newest→oldest under the budget, prior summaries filtered.
  const preserved: string[] = [];
  let budget = 0;
  for (let i = compressible.length - 1; i >= 0; i--) {
    const m = compressible[i];
    if (m === undefined || m.role !== "user" || isCompactSummary(m.content)) continue;
    const cost = estimateTokens(m.content);
    if (budget + cost > COMPACT_USER_MESSAGE_MAX_TOKENS) break;
    budget += cost;
    preserved.unshift(m.content); // chronological order in the replacement
  }

  const summary = `${COMPACT_SUMMARY_MARKER}\n${summaryBody}`;

  // Append-only write: boundary (new root) + replacement chained onto it.
  const transcript = SessionTranscript.fromRecords(prior, {
    cwd: opts.loc.cwd,
    sessionId: opts.sessionId,
    model: opts.loc.model ?? "unknown",
  });
  transcript.appendCompactBoundary({ preTokens, trigger: opts.trigger });
  for (const text of preserved) transcript.appendUserTurn(text);
  transcript.appendUserTurn(summary);
  const delta = transcript.records().slice(prior.length);
  await opts.store.appendRecords(opts.loc.agentId, delta);

  const postTokens = estimateTokens([...preserved, summary].join("\n"));
  return { preTokens, postTokens };
}

// ─── Default summarizer (the ADR-D440 subsystem's first real caller) ─────────────────────────────

/**
 * Build the default summarizer for `Agent.compact`: the D440 `compressConversationWindow`
 * (aux-LLM summarization with typed failure) driven by a router-resolved LLM client. The
 * compression model resolves via the D440 registry with the agent's own model as fallback.
 */
export function buildDefaultSummarizer(opts: {
  agentModel: string;
  apiKey?: string;
}): (messages: readonly CompressibleMessage[]) => Promise<string> {
  return async (messages) => {
    const { compressConversationWindow } = await import(
      "../runtime/compression/compression-summarizer.js"
    );
    const { resolveCompressionModel } = await import(
      "../runtime/compression/compression-model-registry.js"
    );
    const { resolveProviderChain } = await import("../llm/router.js");

    let model: string;
    try {
      model = resolveCompressionModel(opts.agentModel);
    } catch {
      model = opts.agentModel; // registry miss — summarize with the agent's own model
    }
    const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "openai";

    const callLlm = async (m: string, system: string, user: string): Promise<string> => {
      const chain = resolveProviderChain({
        primary: provider,
        ...(opts.apiKey !== undefined ? { apiKeys: { [provider]: [opts.apiKey] } } : {}),
      });
      const client = chain[0];
      if (client === undefined) throw new Error(`no LLM client for provider "${provider}"`);
      const controller = new AbortController();
      let text = "";
      const stream = client.stream(
        { model: m, system, messages: [{ role: "user", content: [{ type: "text", text: user }] }] },
        controller.signal,
      );
      for (;;) {
        const step = await stream.next();
        if (step.done === true) break;
        if (step.value.type === "text_delta") text += step.value.text;
        if (step.value.type === "error") throw new Error(step.value.message);
      }
      return text;
    };

    const summary = await compressConversationWindow({ messages: [...messages], model, callLlm });
    return summary.content;
  };
}

// ─── Auto-compaction (Codex formula: fire at usage_real >= (cw*9)/10) ────────────────────────────

/**
 * Should auto-compaction fire? Codex parity: `token_limit_reached` when real usage crosses 90% of
 * the model's context window (`context_window.rs:74-79`; limit default `(cw*9)/10`,
 * `openai_models.rs:459-469`). Missing inputs (no usage reported / model absent from the catalog)
 * NEVER fire — fail-safe toward "do nothing".
 */
export function shouldAutoCompact(opts: {
  usageTotal?: number | undefined;
  contextWindow?: number | undefined;
}): boolean {
  if (opts.usageTotal === undefined || opts.contextWindow === undefined) return false;
  if (opts.usageTotal <= 0 || opts.contextWindow <= 0) return false;
  return opts.usageTotal >= Math.floor((opts.contextWindow * 9) / 10);
}

/** Anti-cascade bookkeeping: last turn we ATTEMPTED an auto-compact, per agent (globalThis — M44 B1). */
const autoCompactAttempts = (() => {
  const g = globalThis as unknown as Record<symbol, Map<string, number>>;
  const sym = Symbol.for("theokit-sdk.session.auto-compact-attempts");
  if (g[sym] === undefined) g[sym] = new Map<string, number>();
  return g[sym];
})();

/**
 * Fire auto-compaction when the threshold is crossed — at most ONE attempt per turn per agent
 * (anti-cascade: a failing summarizer or a non-reducing summary must not loop). Returns whether a
 * compaction actually happened. Failures WARN and leave the transcript untouched.
 */
export async function autoCompactIfNeeded(opts: {
  store: SessionStore;
  loc: CompactLocation;
  sessionId: string;
  usageTotal?: number | undefined;
  contextWindow?: number | undefined;
  turnCount: number;
  summarize: (messages: readonly CompressibleMessage[]) => Promise<string>;
}): Promise<boolean> {
  if (!shouldAutoCompact(opts)) return false;
  const key = `${opts.loc.cwd}::${opts.loc.agentId}`;
  if (autoCompactAttempts.get(key) === opts.turnCount) return false; // already attempted this turn
  autoCompactAttempts.set(key, opts.turnCount);
  try {
    await compactSessionTranscript({
      store: opts.store,
      loc: opts.loc,
      sessionId: opts.sessionId,
      trigger: "auto",
      summarize: opts.summarize,
    });
    return true;
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] auto-compaction failed (left transcript untouched): ${msg}\n`);
    return false;
  }
}
