/**
 * PersonalityStore — session-default + persistent JSON state of the
 * currently-active personality slug per agentId (T2.1, ADR D163).
 *
 * Storage layout (`$THEOKIT_HOME/personality.json`):
 *
 * ```json
 * { "version": 1, "agents": { "agent-xyz": "coder" } }
 * ```
 *
 * **EC-B (MUST FIX):** `setActive(agentId, undefined, { save: true })`
 * **DELETES** the key from the `agents` map. Never writes `null`.
 * "Key absent === no active personality" is the single canonical
 * representation. Hydration only reads present keys.
 *
 * **EC-N (DOCUMENT):** Brief memory/disk divergence on persist failure is
 * tolerated — session state always wins; next successful call recovers.
 * Disk write failures log a one-shot warn (via redactSecrets) and do NOT
 * throw to the caller (mirrors credential-pool EC-A pattern).
 *
 * Cross-process safety: writes go through `withFileLock` (D61) and use
 * `atomicWriteJson` (atomic rename). Reads always re-load from disk
 * inside the lock so concurrent writers don't lose updates (EC-6).
 *
 * @internal
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteJson } from "../persistence/atomic-write.js";
import { withFileLock } from "../persistence/file-lock.js";
import { getTheokitHome } from "../persistence/paths.js";
import { warnOnce } from "../runtime/hooks-source.js";
import { redactSecrets } from "../security/redact.js";

interface PersonalityStateV1 {
  readonly version: 1;
  readonly agents: Record<string, string>;
}

const SCHEMA_VERSION = 1;
const FILE_NAME = "personality.json";

function emptyState(): PersonalityStateV1 {
  return { version: SCHEMA_VERSION, agents: {} };
}

function isStateV1(value: unknown): value is PersonalityStateV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as { version?: unknown; agents?: unknown };
  if (v.version !== SCHEMA_VERSION) return false;
  if (v.agents === null || typeof v.agents !== "object") return false;
  return true;
}

async function readState(filePath: string): Promise<PersonalityStateV1> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyState();
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnOnce(
      "personality-store-json-parse",
      "[theokit-sdk] personality.json is malformed; treating as empty",
    );
    return emptyState();
  }
  if (!isStateV1(parsed)) {
    warnOnce(
      "personality-store-bad-version",
      `[theokit-sdk] personality.json has unknown version; treating as empty (file kept untouched)`,
    );
    return emptyState();
  }
  return parsed;
}

/**
 * Tracks per-agent personality slug in session memory; optionally persists
 * via JSON file under `$THEOKIT_HOME/personality.json`.
 *
 * @internal
 */
export class PersonalityStore {
  readonly #cwd: string;
  readonly #session = new Map<string, string>();

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  /** Active personality slug for `agentId`. Undefined = no active preset. */
  active(agentId: string): string | undefined {
    return this.#session.get(agentId);
  }

  /**
   * Set active personality. Returns previous value (for cache-invalidation
   * decisions in the caller). When `opts.save: true`, also persists to
   * the on-disk JSON file. Persist failures log+continue (never throw).
   */
  async setActive(
    agentId: string,
    slug: string | undefined,
    opts?: { save?: boolean },
  ): Promise<string | undefined> {
    const previous = this.#session.get(agentId);
    if (slug === undefined) this.#session.delete(agentId);
    else this.#session.set(agentId, slug);

    if (opts?.save === true) {
      try {
        await this.#persist(agentId, slug);
      } catch (err) {
        warnOnce(
          `personality-store-persist-failure-${agentId}`,
          `[theokit-sdk] personality persist failed for ${redactSecrets(agentId)}: ${redactSecrets(
            (err as Error).message,
          )}`,
        );
      }
    }
    return previous;
  }

  /** Hydrate session state for `agentId` from the persistent file. */
  async hydrate(agentId: string): Promise<void> {
    const filePath = this.#filePath();
    let state: PersonalityStateV1;
    try {
      // Hydrate is read-only; no need for cross-process lock (writers
      // already use atomic rename via atomicWriteJson, so reads observe
      // either the old or new state — never torn writes).
      state = await readState(filePath);
    } catch (err) {
      warnOnce(
        `personality-store-hydrate-failure-${agentId}`,
        `[theokit-sdk] personality hydrate failed for ${redactSecrets(agentId)}: ${redactSecrets(
          (err as Error).message,
        )}`,
      );
      return;
    }
    const slug = state.agents[agentId];
    if (slug !== undefined) this.#session.set(agentId, slug);
    else this.#session.delete(agentId);
  }

  /** Test-only reset. @internal */
  _reset(): void {
    this.#session.clear();
  }

  async #persist(agentId: string, slug: string | undefined): Promise<void> {
    const filePath = this.#filePath();
    // withFileLock needs the parent dir to exist (lock companion is sibling
    // to filePath). atomicWriteJson does its own mkdir but runs INSIDE the
    // lock — so ensure the dir up front.
    await mkdir(dirname(filePath), { recursive: true });
    await withFileLock(filePath, async () => {
      const current = await readState(filePath);
      const nextAgents = { ...current.agents };
      if (slug === undefined) delete nextAgents[agentId];
      else nextAgents[agentId] = slug;
      const next: PersonalityStateV1 = { version: SCHEMA_VERSION, agents: nextAgents };
      await atomicWriteJson(filePath, next);
    });
  }

  #filePath(): string {
    return join(getTheokitHome(this.#cwd), FILE_NAME);
  }
}
