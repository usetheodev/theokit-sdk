import type { ActiveMemoryCache } from "./active-memory-cache.js";
// T4.1 / D438 — `ActiveMemoryResult` and its helpers moved to `./active-memory-types.ts`
// so `./active-memory-cache.ts` can reach them without cycling back here (cycle #10).
// Re-exported below for back-compat with in-tree consumers.
import type {
  ActiveMemoryQueryMode,
  ActiveMemoryResult,
  ActiveMemoryStatus,
} from "./active-memory-types.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { MemorySearchHit } from "./index-manager.js";
import type { MemoryIndex } from "./memory-index.js";
import { persistActiveMemoryTranscript } from "./transcript-store.js";

export type { ActiveMemoryQueryMode, ActiveMemoryResult, ActiveMemoryStatus };

/**
 * Active Memory blocking recall (ADR D6 of memory-system-openclaw-parity).
 *
 * Runs BEFORE `agent.send()` assembles the system prompt. Issues a direct
 * call to `IndexManager.search` with the user message (and optional recent
 * turns per `queryMode`).
 *
 * Returns a `summary` string capped at `maxSummaryChars` (default 220 to
 * match OpenClaw's `DEFAULT_MAX_SUMMARY_CHARS`) which the system-prompt
 * pipeline prepends as a `<active-memory>` block (priority 5).
 *
 * @internal
 */

// T4.1 / D438 — `ActiveMemoryQueryMode`, `ActiveMemoryStatus`, and
// `ActiveMemoryResult` now live in `./active-memory-types.ts` and are
// re-exported at the top of this module for back-compat.

export interface ActiveMemoryOptions {
  /** Whether active recall is enabled. Default `false`. */
  enabled?: boolean;
  /** Query construction strategy. Default `"recent"`. */
  queryMode?: ActiveMemoryQueryMode;
  /** Hard timeout in ms. Default `15000`. */
  timeoutMs?: number;
  /** Max chars in the summary. Default `220`. */
  maxSummaryChars?: number;
  /** Number of recent user turns to include in `queryMode === "recent"`. Default `2`. */
  recentUserTurns?: number;
}

export interface RunActiveMemoryArgs {
  userText: string;
  priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
  index: MemoryIndex | undefined;
  options: ActiveMemoryOptions;
  /** Per-agent circuit breaker (Phase 8). */
  breaker?: CircuitBreaker;
  /** Per-agent result cache (Phase 8). */
  cache?: ActiveMemoryCache;
  /** Workspace root for transcript persistence. */
  cwd?: string;
  /** When true, write transcript JSON under .theokit/memory/transcripts/active-memory/. */
  persistTranscripts?: boolean;
  /** Stable key the breaker + cache key by (default `default`). */
  agentKey?: string;
  /** Run id for transcript file naming. */
  runId?: string;
}

const DEFAULTS: Required<Omit<ActiveMemoryOptions, "enabled">> = {
  queryMode: "recent",
  timeoutMs: 15000,
  maxSummaryChars: 220,
  recentUserTurns: 2,
};

export async function runActiveMemory(args: RunActiveMemoryArgs): Promise<ActiveMemoryResult> {
  const started = Date.now();
  if (args.options.enabled !== true || args.index === undefined) {
    return { summary: undefined, durationMs: 0, status: "skipped", hits: [] };
  }
  const cfg = { ...DEFAULTS, ...args.options };
  const breakerKey = args.agentKey ?? "default";
  if (args.breaker?.shouldSkip(breakerKey) === true) {
    return { summary: undefined, durationMs: 0, status: "skipped", hits: [] };
  }
  const cached = args.cache?.get(args.userText, cfg.queryMode);
  if (cached !== undefined) return cached;

  const query = buildQuery(args.userText, args.priorMessages, cfg.queryMode, cfg.recentUserTurns);
  if (query.trim().length === 0) {
    return finalize(args, cfg.queryMode, {
      summary: undefined,
      durationMs: Date.now() - started,
      status: "no-recall",
      hits: [],
    });
  }
  const result = await searchOnce(args, cfg, query, started);
  notifyBreaker(args.breaker, breakerKey, result.status);
  return finalize(args, cfg.queryMode, result);
}

interface ResolvedConfig {
  queryMode: ActiveMemoryQueryMode;
  timeoutMs: number;
  maxSummaryChars: number;
  recentUserTurns: number;
}

async function searchOnce(
  args: RunActiveMemoryArgs,
  cfg: ResolvedConfig,
  query: string,
  started: number,
): Promise<ActiveMemoryResult> {
  if (args.index === undefined) {
    return { summary: undefined, durationMs: 0, status: "skipped", hits: [] };
  }
  try {
    const hits = await withTimeout(args.index.search(query, { maxResults: 5 }), cfg.timeoutMs);
    if (hits === "timeout") {
      return { summary: undefined, durationMs: Date.now() - started, status: "timeout", hits: [] };
    }
    if (hits.length === 0) {
      return {
        summary: undefined,
        durationMs: Date.now() - started,
        status: "no-recall",
        hits: [],
      };
    }
    const summary = formatSummary(hits, cfg.maxSummaryChars);
    return { summary, durationMs: Date.now() - started, status: "ok", hits };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] active-memory recall failed: ${message}\n`);
    return { summary: undefined, durationMs: Date.now() - started, status: "error", hits: [] };
  }
}

function notifyBreaker(
  breaker: CircuitBreaker | undefined,
  key: string,
  status: ActiveMemoryStatus,
): void {
  if (breaker === undefined) return;
  if (status === "timeout") breaker.recordTimeout(key);
  else if (status === "ok" || status === "no-recall") breaker.recordSuccess(key);
}

async function finalize(
  args: RunActiveMemoryArgs,
  queryMode: ActiveMemoryQueryMode,
  result: ActiveMemoryResult,
): Promise<ActiveMemoryResult> {
  args.cache?.set(args.userText, queryMode, result);
  if (args.persistTranscripts === true && args.cwd !== undefined) {
    await persistActiveMemoryTranscript(args.cwd, {
      runId: args.runId ?? `run-${Date.now()}`,
      startedAtMs: Date.now() - result.durationMs,
      userText: args.userText,
      queryMode,
      status: result.status,
      durationMs: result.durationMs,
      summary: result.summary,
      hits: result.hits.map((h) => ({
        path: h.path,
        startLine: h.startLine,
        endLine: h.endLine,
        score: h.score,
        snippet: h.snippet,
      })),
    });
  }
  return result;
}

function buildQuery(
  userText: string,
  priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  queryMode: ActiveMemoryQueryMode,
  recentUserTurns: number,
): string {
  if (queryMode === "message") return userText;
  if (queryMode === "full") {
    const allUserTurns = priorMessages.filter((m) => m.role === "user").map((m) => m.text);
    return [...allUserTurns, userText].join("\n");
  }
  // recent
  const recent = priorMessages
    .filter((m) => m.role === "user")
    .slice(-recentUserTurns)
    .map((m) => m.text);
  return [...recent, userText].join("\n");
}

function formatSummary(hits: ReadonlyArray<MemorySearchHit>, maxChars: number): string {
  const lines = hits.map((h) => `- ${h.citation}: ${h.snippet}`);
  let summary = lines.join("\n");
  if (summary.length > maxChars) summary = `${summary.slice(0, maxChars - 1)}…`;
  return summary;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const winner = await Promise.race([promise, timeout]);
    return winner;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
