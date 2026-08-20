import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "@theokit/sdk/persistence";
import { redactSecrets } from "../memory-types.js";
import { memoryDir } from "./markdown-store.js";

/**
 * Per-run session summary writer (ADR D20).
 *
 * After every finished run, write a markdown summary to
 * `.theokit/memory/sessions/<runId>.md`. IndexManager picks these up with
 * `source="sessions"` so `memory_search({ corpus: "sessions" })` can recall
 * past conversations.
 *
 * EC-9: only `status === "finished"` runs trigger a write. Cancelled/errored
 * runs would otherwise pollute the recall corpus with partial transcripts.
 *
 * Iter 61 (Stage 3 source-move #18): hybrid copy from sdk-core's
 * `internal/memory/storage/session-summary-writer.ts`. sdk-core
 * retains its copy for v1.x sessions back-compat; sdk-memory ships
 * the canonical copy that the future `session-loader.ts` move will
 * compose with as a sibling (loader reads back the markdown files
 * this writer emits). Dependency chain (all resolved):
 * - `@theokit/sdk/persistence` for `replaceFileAtomic`
 * - sibling `./markdown-store.js` for `memoryDir` (moved iter 56)
 * - sibling `./memory-types.js` for `redactSecrets` (moved iter 52)
 *
 * @internal
 */

export interface SessionSummaryInput {
  cwd: string;
  runId: string;
  agentId: string;
  userText: string;
  assistantText: string;
  status: "finished" | "running" | "error" | "cancelled";
  at: number;
}

const MAX_TURN_CHARS = 2000;

/**
 * Path to `<memory root>/sessions`, where one markdown summary per finished run
 * is written. `IndexManager.sync()` indexes these with `source: "sessions"`.
 * Pure path computation.
 */
export function sessionsDir(cwd: string): string {
  return join(memoryDir(cwd), "sessions");
}

/**
 * Path of the summary file for a run.
 *
 * The run id is sanitised before it reaches the path: every character outside
 * `[a-zA-Z0-9_-]` becomes an underscore and the result is cut to 128
 * characters. That keeps a hostile id inside the sessions directory, and it also
 * means two different ids can collide onto one file — pass ids that are already
 * within the safe alphabet if that matters.
 */
export function sessionSummaryPath(cwd: string, runId: string): string {
  return join(sessionsDir(cwd), `${sanitizeRunId(runId)}.md`);
}

function sanitizeRunId(runId: string): string {
  // Strip path separators and obvious traversal patterns so a malicious
  // run-id cannot escape the sessions directory. Keep `[a-zA-Z0-9_-]`.
  return runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

function truncate(text: string): string {
  if (text.length <= MAX_TURN_CHARS) return text;
  return `${text.slice(0, MAX_TURN_CHARS)}…`;
}

/**
 * Write a session summary file. EC-9: a non-finished status returns early
 * without touching disk. Secrets in both user and assistant text are
 * redacted via the shared `redactSecrets` pattern.
 *
 * @internal
 */
export async function writeSessionSummary(input: SessionSummaryInput): Promise<void> {
  if (input.status !== "finished") return;
  const path = sessionSummaryPath(input.cwd, input.runId);
  await mkdir(sessionsDir(input.cwd), { recursive: true });

  const safeUser = redactSecrets(truncate(input.userText));
  const safeAssistant = redactSecrets(truncate(input.assistantText));
  const iso = new Date(input.at).toISOString();

  const body = [
    "---",
    `runId: ${input.runId}`,
    `agentId: ${input.agentId}`,
    `at: ${iso}`,
    `status: ${input.status}`,
    "---",
    "",
    "## User",
    "",
    safeUser,
    "",
    "## Assistant",
    "",
    safeAssistant,
    "",
  ].join("\n");

  await replaceFileAtomic(path, body);
}
