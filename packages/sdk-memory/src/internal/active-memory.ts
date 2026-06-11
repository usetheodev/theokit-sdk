/**
 * Active Memory blocking recall (ADR D6 of memory-system-peer-project-parity).
 *
 * Runs BEFORE `agent.send()` assembles the system prompt. Issues a direct
 * call to `IndexManager.search` with the user message (and optional recent
 * turns per `queryMode`).
 *
 * Returns a `summary` string capped at `maxSummaryChars` (default 220 to
 * match peer-project's `DEFAULT_MAX_SUMMARY_CHARS`) which the system-prompt
 * pipeline prepends as a `<active-memory>` block (priority 5).
 *
 * Iter 75 (Stage 3 source-move #38, FINAL move): hybrid copy from
 * sdk-core's `internal/memory/active-memory.ts`. sdk-core retains its
 * copy as the v1.x runtime that `Memory` class delegates to;
 * sdk-memory ships the canonical copy that future Stage 4 port-based
 * composition will consume.
 *
 * **CLOSES the Stage 3 source-move stage in sdk-memory.** Every
 * memory-related concept under sdk-core's internal/memory/ is now
 * canonical in @theokit/sdk-memory (38 source files moved across
 * iter 44-75; 2 inlined adapters added: adapter-http-error iter 73
 * + adapter-catalog renamed iter 74).
 *
 * **Cross-package telemetry contract:** sdk-core's `internal/telemetry/`
 * is not part of the public surface. sdk-memory inlines minimal
 * structural mirrors of `OTelSpan` + `TelemetryHandle` here AND the
 * 2 constant strings the file uses (`memory.recall` span name +
 * `theokit_memory_recall_duration_ms` histogram name). The runtime
 * still receives + emits the canonical types via consumer call sites
 * — the structural mirrors only satisfy this file's local type
 * checking. When sdk-core exposes telemetry types publicly, these
 * mirrors MUST be replaced with the canonical imports.
 *
 * @internal
 */

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
import type { MemorySearchHit } from "./index-manager-contract.js";
import type { MemoryIndex } from "./memory-index.js";
import { persistActiveMemoryTranscript } from "./transcript-store.js";

export type { ActiveMemoryQueryMode, ActiveMemoryResult, ActiveMemoryStatus };

// Iter 75 inlined constants — sdk-core's telemetry/span-names.ts is
// not public. These two are the only ones this file uses.
const SPAN_MEMORY_RECALL = "memory.recall";
const HISTOGRAM_MEMORY_RECALL_DURATION_MS = "theokit_memory_recall_duration_ms";

// Iter 75 inlined telemetry mirrors — sdk-core's telemetry/tracer.ts
// `OTelSpan` + `TelemetryHandle` types are not public. Structural
// mirrors below capture the surface this file actually uses.
interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(exception: unknown): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
  isRecording(): boolean;
}

interface TelemetryHandle {
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): OTelSpan;
  recordHistogram(
    name: string,
    value: number,
    attrs?: Record<string, string | number | boolean>,
  ): void;
}

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
  /**
   * T0.1 — optional telemetry handle. When provided AND telemetry is enabled,
   * `memory.recall` span is emitted with `{ userId, namespace, scope, queryMode,
   * hits, status }` attrs and `theokit_memory_recall_duration_ms` histogram is
   * recorded with the same dimension keys.
   */
  telemetry?: TelemetryHandle;
  /** User id surfaced as a memory.recall span attr for cross-tenant tracing. */
  userId?: string;
  /** Memory namespace (e.g. `default`, `<orgId>`) for span/histogram dimensions. */
  namespace?: string;
  /** Memory scope (`session` / `user` / `global`) for span/histogram dimensions. */
  scope?: string;
}

const DEFAULTS: Required<Omit<ActiveMemoryOptions, "enabled">> = {
  queryMode: "recent",
  timeoutMs: 15000,
  maxSummaryChars: 220,
  recentUserTurns: 2,
};

export async function runActiveMemory(args: RunActiveMemoryArgs): Promise<ActiveMemoryResult> {
  const started = Date.now();
  // T0.1 — `memory.recall` span emitted around the entire body so skipped /
  // cached / no-recall paths still surface in telemetry with the correct status.
  const span = startMemoryRecallSpan(args);
  try {
    if (args.options.enabled !== true || args.index === undefined) {
      return endRecallSpan(span, args, {
        summary: undefined,
        durationMs: 0,
        status: "skipped",
        hits: [],
      });
    }
    const cfg = { ...DEFAULTS, ...args.options };
    const breakerKey = args.agentKey ?? "default";
    if (args.breaker?.shouldSkip(breakerKey) === true) {
      return endRecallSpan(span, args, {
        summary: undefined,
        durationMs: 0,
        status: "skipped",
        hits: [],
      });
    }
    const cached = args.cache?.get(args.userText, cfg.queryMode);
    if (cached !== undefined) return endRecallSpan(span, args, cached);

    const query = buildQuery(args.userText, args.priorMessages, cfg.queryMode, cfg.recentUserTurns);
    if (query.trim().length === 0) {
      const finalized = await finalize(args, cfg.queryMode, {
        summary: undefined,
        durationMs: Date.now() - started,
        status: "no-recall",
        hits: [],
      });
      return endRecallSpan(span, args, finalized);
    }
    const result = await searchOnce(args, cfg, query, started);
    notifyBreaker(args.breaker, breakerKey, result.status);
    const finalized = await finalize(args, cfg.queryMode, result);
    return endRecallSpan(span, args, finalized);
  } catch (cause) {
    span.recordException(cause);
    span.setStatus({ code: 2, message: cause instanceof Error ? cause.message : String(cause) });
    span.end();
    throw cause;
  }
}

function startMemoryRecallSpan(args: RunActiveMemoryArgs): OTelSpan {
  const telemetry: TelemetryHandle | undefined = args.telemetry;
  if (telemetry === undefined) {
    // No-op span identical to the runtime no-op when telemetry is disabled.
    return {
      setAttribute: () => {},
      setAttributes: () => {},
      addEvent: () => {},
      setStatus: () => {},
      recordException: () => {},
      end: () => {},
      spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16) }),
      isRecording: () => false,
    };
  }
  return telemetry.startSpan(SPAN_MEMORY_RECALL, {
    queryMode: args.options.queryMode ?? "recent",
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
    ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
    ...(args.scope !== undefined ? { scope: args.scope } : {}),
  });
}

function endRecallSpan(
  span: OTelSpan,
  args: RunActiveMemoryArgs,
  result: ActiveMemoryResult,
): ActiveMemoryResult {
  span.setAttributes({
    hits: result.hits.length,
    status: result.status,
    durationMs: result.durationMs,
  });
  span.end();
  args.telemetry?.recordHistogram(HISTOGRAM_MEMORY_RECALL_DURATION_MS, result.durationMs, {
    status: result.status,
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
    ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
    ...(args.scope !== undefined ? { scope: args.scope } : {}),
  });
  return result;
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
