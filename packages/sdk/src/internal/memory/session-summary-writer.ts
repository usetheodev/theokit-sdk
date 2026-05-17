import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "./atomic-write.js";
import { memoryDir } from "./markdown-store.js";
import { redactSecrets } from "./types.js";

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

export function sessionsDir(cwd: string): string {
  return join(memoryDir(cwd), "sessions");
}

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
