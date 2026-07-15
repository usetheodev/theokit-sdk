/**
 * SE41 — `FsSessionStore`, the DEFAULT reference implementation of the pluggable
 * {@link SessionStore} seam. It reads and append-writes the native Claude-shaped
 * `.jsonl` transcript at `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl` — the
 * exact on-disk format SE40 introduced (the file the Claude Code CLI can
 * `--continue`). Omitting `local.sessionStore` resolves to this store, so the
 * default persistence path is byte-identical to SE40 behavior.
 *
 * `readRecords` is `readTranscript(transcriptPath(...))` (a missing session →
 * `[]`, not an error — a fresh agent has no history). `appendRecords` is a TRUE
 * append: it reads the prior records, concatenates the new-turn delta, and
 * rewrites the whole line set atomically under the SE40 cross-process file lock
 * (`writeTranscript` never shrinks — the native format is an append-only
 * `parentUuid` DAG). The parent dir is created BEFORE acquiring the lock because
 * the lock's companion `<path>.lock` file needs an existing parent dir (the SE40
 * `mkdir(dirname)`-before-lock fix).
 *
 * @internal
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { SessionStore } from "../../types/session-store.js";
import { withFileLock } from "./file-lock.js";
import {
  readTranscript,
  type SessionRecord,
  transcriptPath,
  writeTranscript,
} from "./session-transcript.js";

/** Options identifying the on-disk transcript location for the FS default store. */
export interface FsSessionStoreOptions {
  /** Transcript base dir (`~/.theokit` default, `~/.claude` for CLI interop) — already `~`-expanded. */
  baseDir: string;
  /** The workspace cwd whose encoded form is the transcript project dir. */
  cwd: string;
}

/**
 * The default `SessionStore` — reads/append-writes the native `.jsonl` transcript.
 *
 * @internal
 */
export class FsSessionStore implements SessionStore {
  readonly #baseDir: string;
  readonly #cwd: string;

  constructor(options: FsSessionStoreOptions) {
    this.#baseDir = options.baseDir;
    this.#cwd = options.cwd;
  }

  async readRecords(agentId: string): Promise<SessionRecord[]> {
    return readTranscript(transcriptPath(this.#baseDir, this.#cwd, agentId));
  }

  async appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void> {
    // Empty delta → nothing to persist (avoids an unnecessary lock + rewrite).
    if (records.length === 0) return;
    const path = transcriptPath(this.#baseDir, this.#cwd, agentId);
    // mkdir BEFORE the lock: withFileLock's companion `<path>.lock` needs the parent dir.
    await mkdir(dirname(path), { recursive: true });
    await withFileLock(path, async () => {
      const prior = await readTranscript(path);
      await writeTranscript(path, [...prior, ...records]);
    });
  }
}
