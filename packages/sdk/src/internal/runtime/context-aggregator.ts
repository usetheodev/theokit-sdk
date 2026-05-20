/**
 * Aggregate context cap (T4.1, ADR D155).
 *
 * After per-file truncation, applies a second-level cap on the TOTAL
 * size across all sources. Lower-priority sources are dropped when the
 * sum would exceed `maxBytesTotal`. The last partially-fitting source
 * is truncated to fit exactly into the remaining budget.
 *
 * EC-J: same-priority sources tie-break by absolute source path
 * lex-ascending for deterministic ordering (prompt-cache stability).
 *
 * @internal
 */

import { truncateWithMarker } from "./context-loaders.js";

/** Default aggregate cap (120k chars across all context files). D155. */
export const DEFAULT_MAX_BYTES_TOTAL = 120_000;

export interface AggregatorSource {
  readonly id: string;
  readonly source: string;
  readonly content: string;
  readonly priority: number;
  readonly truncated: boolean;
}

export interface AggregateResult {
  readonly kept: AggregatorSource[];
  readonly dropped: AggregatorSource[];
}

/**
 * Sort by priority ascending, tie-break by source path lex (EC-J),
 * then drop / partial-truncate to fit `maxBytesTotal`.
 *
 * @internal
 */
export function applyAggregateCap(
  sources: ReadonlyArray<AggregatorSource>,
  maxTotal: number,
): AggregateResult {
  // EC-J: deterministic ordering. Priority asc, then path lex asc.
  const sorted = [...sources].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.source.localeCompare(b.source);
  });

  let totalBytes = 0;
  const kept: AggregatorSource[] = [];
  const dropped: AggregatorSource[] = [];

  for (const s of sorted) {
    if (totalBytes + s.content.length <= maxTotal) {
      kept.push(s);
      totalBytes += s.content.length;
      continue;
    }
    const remaining = maxTotal - totalBytes;
    if (remaining > 0) {
      // Partial keep — truncate this one to fit.
      const { finalContent } = truncateWithMarker(s.content, remaining);
      kept.push({ ...s, content: finalContent, truncated: true });
      totalBytes = maxTotal;
    } else {
      dropped.push(s);
    }
  }

  if (dropped.length > 0) {
    emitTotalDropCounter(dropped.map((d) => d.source));
  }
  return { kept, dropped };
}

function emitTotalDropCounter(droppedSources: string[]): void {
  const tracer = (
    globalThis as { __theokit_tracer?: { inc?: (k: string, attrs: unknown) => void } }
  ).__theokit_tracer;
  if (tracer?.inc === undefined) return;
  try {
    tracer.inc("context_files_total_truncated", { dropped: droppedSources });
  } catch {
    // Telemetry must never break.
  }
}
