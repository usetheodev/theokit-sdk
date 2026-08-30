import { join } from "node:path";
import { diag } from "../../diagnostics.js";
import { atomicWriteJson } from "../../persistence/atomic-write.js";
import type { MemoryRoot } from "./memory-root.js";

/**
 * Optional on-disk persistence for Active Memory recall transcripts (ADR D6).
 *
 * Writes one JSON file per run under
 * `.theokit/memory/transcripts/active-memory/<runId>.json` when the agent
 * passes `persistTranscripts: true`. Failures are swallowed with a stderr
 * warning so transcript IO never crashes the agent run.
 *
 * Shared with `@theokit/sdk-memory` through the semver-exempt `internal/memory-store`
 * sub-path, so it carries no internal-visibility tag. `stripInternal` matches that tag as TEXT
 * anywhere in the block, so naming it here — even in backticks, even to say it is absent — deletes
 * this symbol from the published declarations and forces the satellite back onto a copy. Measured:
 * the first draft of this very note did exactly that. See #430 and #463.
 */

export interface ActiveMemoryTranscript {
  runId: string;
  startedAtMs: number;
  userText: string;
  queryMode: string;
  status: string;
  durationMs: number;
  summary: string | undefined;
  hits: ReadonlyArray<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
  }>;
}

/**
 * Write one active-memory recall transcript under `<memory root>/transcripts/active-memory`.
 *
 * Never throws. Transcript IO is observability, and observability must not break the run it merely
 * observes — a failure is reported through the diagnostics sink and swallowed.
 */
export async function persistActiveMemoryTranscript(
  root: MemoryRoot,
  transcript: ActiveMemoryTranscript,
): Promise<void> {
  try {
    const dir = join(root, "transcripts", "active-memory");
    const file = join(dir, `${transcript.runId}.json`);
    // atomicWriteJson auto-creates the parent directory + writes atomically
    // (no torn writes during crash).
    await atomicWriteJson(file, transcript);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    diag(`[theokit-sdk] active-memory transcript persist failed: ${message}\n`);
  }
}
