import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { memoryDir } from "./markdown-store.js";

/**
 * Optional on-disk persistence for Active Memory recall transcripts (ADR D6).
 *
 * Writes one JSON file per run under
 * `.theokit/memory/transcripts/active-memory/<runId>.json` when the agent
 * passes `persistTranscripts: true`. Failures are swallowed with a stderr
 * warning so transcript IO never crashes the agent run.
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

export async function persistActiveMemoryTranscript(
  cwd: string,
  transcript: ActiveMemoryTranscript,
): Promise<void> {
  try {
    const dir = join(memoryDir(cwd), "transcripts", "active-memory");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${transcript.runId}.json`);
    await writeFile(file, JSON.stringify(transcript, null, 2), "utf8");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] active-memory transcript persist failed: ${message}\n`);
  }
}
