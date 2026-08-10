import { atomicWriteTempTarget } from "./atomic-write.js";

/**
 * The kinds of file this SDK leaves in a project's transcript directory.
 *
 * - `transcript` — the session itself (`transcriptPath`).
 * - `writer-lock` — the cross-process writer lease (`session-writer.ts`, `<file>.writer.lock`).
 * - `lock-directory` — `withFileLock`'s companion, taken by `mkdir`, so it is a DIRECTORY.
 * - `temp` — what `replaceFileAtomic` leaves when a process dies between the open and the rename.
 */
export type SessionArtifact = "transcript" | "writer-lock" | "lock-directory" | "temp";

/**
 * U-1 — what is this entry, if it is one of ours?
 *
 * The SDK writes four kinds of file into a project directory and reasons about none of them
 * afterwards: there is no retention, no collector, and there was no way even to ask what an entry
 * IS. A consumer wanting to reclaim disk had to re-derive the suffixes by reading this source — and
 * one did, which means a suffix changing here would have left its classifier silently mislabelling
 * files on a path that deletes them.
 *
 * This is deliberately NOT a garbage collector. Retention is policy — how many days, how many to
 * keep, which session is live, whether to delete at all — and policy belongs to the application,
 * which is the only one that can know. What belongs here is the half only the SDK can answer.
 *
 * `undefined` means "not written by this SDK", and it is the answer that matters most: a caller
 * deleting what it does not recognise is how an editor's swap file gets collected. The `temp` case
 * defers to {@link atomicWriteTempTarget} rather than matching `.tmp`, for exactly that reason.
 */
export function classifySessionArtifact(
  name: string,
  isDirectory: boolean,
): SessionArtifact | undefined {
  // `withFileLock` takes its lock by `mkdir`, so the same name as a plain file is not ours.
  if (name.endsWith(".jsonl.lock")) return isDirectory ? "lock-directory" : undefined;
  if (isDirectory) return undefined;
  if (name.endsWith(".jsonl")) return "transcript";
  if (name.endsWith(".writer.lock")) return "writer-lock";
  if (atomicWriteTempTarget(name) !== undefined) return "temp";
  return undefined;
}
