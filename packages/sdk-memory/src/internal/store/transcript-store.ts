import { join } from "node:path";

import { atomicWriteJson } from "@theokit/sdk/persistence";

import { memoryDir } from "./markdown-store.js";

/**
 * Optional on-disk persistence for Active Memory recall transcripts (ADR D6).
 *
 * Writes one JSON file per run under
 * `.theokit/memory/transcripts/active-memory/<runId>.json` when the agent
 * passes `persistTranscripts: true`. Failures are swallowed with a stderr
 * warning so transcript IO never crashes the agent run.
 *
 * Iter 58 (Stage 3 source-move #15): hybrid copy from sdk-core's
 * `internal/memory/storage/transcript-store.ts`. sdk-core retains its
 * copy for v1.x active-memory back-compat; sdk-memory ships the
 * canonical copy that the future `active-memory.ts` move will compose
 * with as a sibling. Dependency chain (both resolved):
 * - `@theokit/sdk/persistence` for `atomicWriteJson`
 * - sibling `./markdown-store.js` for `memoryDir` (moved iter 56)
 *
 * @internal
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
 * Write one recall transcript to
 * `<memory root>/transcripts/active-memory/<runId>.json`, creating the parent
 * directories and replacing the file atomically.
 *
 * Never rejects. A failure is reported on stderr and swallowed, because losing a
 * diagnostic file must not fail the agent run that produced it. That also means
 * a successful resolution is not evidence the file was written.
 *
 * The run id is used verbatim in the file name — unlike the session summary
 * writer, nothing sanitises it here, so pass an id you control.
 */
export async function persistActiveMemoryTranscript(
  cwd: string,
  transcript: ActiveMemoryTranscript,
): Promise<void> {
  try {
    const dir = join(memoryDir(cwd), "transcripts", "active-memory");
    const file = join(dir, `${transcript.runId}.json`);
    // atomicWriteJson auto-creates the parent directory + writes atomically
    // (no torn writes during crash).
    await atomicWriteJson(file, transcript);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] active-memory transcript persist failed: ${message}\n`);
  }
}
