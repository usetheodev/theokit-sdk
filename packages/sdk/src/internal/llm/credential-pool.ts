/**
 * In-memory credential pool with strategy-based rotation (ADRs D123-D133).
 *
 * Pure logic. No I/O — persistence lives in `internal/persistence/
 * credential-pool-store.ts`. The pool is the single source of truth for
 * rotation state within a process; if it diverges from disk (e.g.,
 * process killed mid-rotation per EC-I), the next save heals the
 * inconsistency — at the cost of one extra HTTP 429 per crash.
 *
 * Thread safety: the pool uses an in-process async-aware mutex
 * (`cwd-mutex` D9 keyed by `credential-pool:${provider}`). Cross-process
 * safety happens at the persistence layer via `withFileLock` (D61).
 * Two Node processes sharing the same file may double-pick momentarily
 * (worst case = 1 extra 429 per race) — acceptable per ADR D128.
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import { withCwdMutex } from "../memory/cwd-mutex.js";
import {
  COOLDOWN_MS,
  type CredentialPoolSnapshot,
  type CredentialPoolStrategy,
  DEFAULT_COOLDOWN_MS,
  type PooledCredential,
} from "./credential-pool-types.js";

/**
 * Construct a `PooledCredential` with sane defaults.
 *
 * @internal
 */
export function newPooledCredential(args: {
  provider: string;
  accessToken: string;
  priority: number;
  source: string;
  label?: string;
}): PooledCredential {
  return {
    id: globalThis.crypto.randomUUID(),
    label: args.label ?? labelFromSource(args.source, args.accessToken),
    provider: args.provider,
    priority: args.priority,
    source: args.source,
    accessToken: args.accessToken,
    lastStatus: "ok",
    lastStatusAt: undefined,
    lastErrorCode: undefined,
    lastErrorResetAt: undefined,
    requestCount: 0,
  };
}

/**
 * Build a human-readable label from the credential source. Used for
 * `Theokit.credentialPool.list()` UX. NEVER includes the raw token.
 *
 * @internal
 */
function labelFromSource(source: string, accessToken: string): string {
  if (source.startsWith("env:")) return source.slice(4);
  const masked =
    accessToken.length > 8 ? `${accessToken.slice(0, 4)}…${accessToken.slice(-4)}` : "***";
  return `${source}:${masked}`;
}

/**
 * Per-provider credential pool. Construct with one or more entries
 * sorted by priority. Throws `ConfigurationError` on empty input.
 *
 * EC-C: identical `accessToken`s are deduplicated during construction
 * (3 copies of "k1" → 1 entry). Otherwise an exhaustion event would
 * mark "k1" exhausted 3× wastefully.
 *
 * @internal
 */
export class CredentialPool {
  readonly provider: string;
  private readonly strategy: CredentialPoolStrategy;
  private entries: PooledCredential[];

  constructor(
    provider: string,
    entries: PooledCredential[],
    strategy: CredentialPoolStrategy = "fill_first",
  ) {
    if (entries.length === 0) {
      throw new ConfigurationError(
        `credential-pool: cannot construct empty pool for provider "${provider}"`,
        { code: "credential_pool_empty" },
      );
    }
    this.provider = provider;
    this.strategy = strategy;
    // EC-C: dedupe by accessToken before sort.
    this.entries = dedupeByToken(entries).sort((a, b) => a.priority - b.priority);
  }

  /** True if the pool was seeded with at least one entry. */
  hasCredentials(): boolean {
    return this.entries.length > 0;
  }

  /** True iff at least one entry is healthy (auto-healed if cooldown expired). */
  hasAvailable(): boolean {
    return this.availableEntries().length > 0;
  }

  /** Live (frozen) view of all entries. */
  list(): readonly PooledCredential[] {
    return this.entries;
  }

  /**
   * Pick a healthy entry according to the configured strategy.
   * Mutates `requestCount` and (for round_robin) entry order.
   * Returns null if every entry is in cooldown.
   *
   * @internal
   */
  async select(): Promise<PooledCredential | null> {
    return withCwdMutex(`credential-pool:${this.provider}`, async () => this.selectLocked());
  }

  /**
   * Mark the entry whose id matches `entryId` as exhausted with the
   * appropriate cooldown, then return the next healthy entry (or null).
   * If `entryId` is undefined, marks all currently-active entries (rare —
   * only used by admin reset scenarios).
   *
   * @internal
   */
  async markExhaustedAndRotate(args: {
    entryId: string;
    statusCode: number;
    resetAtMs?: number;
  }): Promise<PooledCredential | null> {
    return withCwdMutex(`credential-pool:${this.provider}`, async () => {
      const entry = this.entries.find((e) => e.id === args.entryId);
      if (entry !== undefined) {
        const now = Date.now();
        const cooldown = COOLDOWN_MS[args.statusCode] ?? DEFAULT_COOLDOWN_MS;
        entry.lastStatus = "exhausted";
        entry.lastStatusAt = now;
        entry.lastErrorCode = args.statusCode;
        // EC-5: negative or stale resetAt → ignore, fall through to default.
        entry.lastErrorResetAt =
          args.resetAtMs !== undefined && args.resetAtMs > now ? args.resetAtMs : now + cooldown;
      }
      return this.selectLocked();
    });
  }

  /** Admin escape hatch: clear all cooldowns. */
  async resetAll(): Promise<void> {
    await withCwdMutex(`credential-pool:${this.provider}`, async () => {
      for (const e of this.entries) {
        e.lastStatus = "ok";
        e.lastStatusAt = undefined;
        e.lastErrorCode = undefined;
        e.lastErrorResetAt = undefined;
      }
    });
  }

  /** Materialize for persistence. */
  toSnapshot(): CredentialPoolSnapshot {
    return {
      provider: this.provider,
      strategy: this.strategy,
      entries: this.entries.map((e) => ({ ...e })),
    };
  }

  /** Hydrate from a previously-saved snapshot. */
  static fromSnapshot(snapshot: CredentialPoolSnapshot): CredentialPool {
    return new CredentialPool(snapshot.provider, snapshot.entries, snapshot.strategy);
  }

  // ─── Internal helpers (always called inside the mutex) ───

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: strategy dispatch must branch on 4 enum values (random/least_used/round_robin/fill_first) with 1-entry short-circuits per strategy. Each branch is 5-10 lines of focused logic; extracting per-strategy methods fragments the linear narrative.
  private selectLocked(): PooledCredential | null {
    const available = this.availableEntries();
    if (available.length === 0) return null;

    if (this.strategy === "random") {
      const idx = Math.floor(Math.random() * available.length);
      const picked = available[idx];
      if (picked === undefined) return null; // unreachable; satisfies strict
      picked.requestCount += 1;
      return picked;
    }

    if (this.strategy === "least_used" && available.length > 1) {
      // EC-3: tie-break by priority ascending (first wins).
      const picked = [...available].sort(
        (a, b) => a.requestCount - b.requestCount || a.priority - b.priority,
      )[0];
      if (picked === undefined) return null;
      picked.requestCount += 1;
      return picked;
    }

    if (this.strategy === "round_robin" && available.length > 1) {
      // Pick head; move it to the end of `entries` so next call picks the next.
      const picked = available[0];
      if (picked === undefined) return null;
      picked.requestCount += 1;
      const rest = this.entries.filter((e) => e.id !== picked.id);
      // Re-assign priorities: rotated entry gets the highest priority value
      // so it sorts last after `fromSnapshot` rehydration. This makes EC-F
      // (round-robin state survives save/load) work without a separate field.
      const maxPriority = this.entries.length - 1;
      rest.forEach((e, i) => {
        e.priority = i;
      });
      picked.priority = maxPriority;
      this.entries = [...rest, picked];
      return picked;
    }

    // fill_first (default) and 1-entry edge case for round_robin/least_used
    const picked = available[0];
    if (picked === undefined) return null;
    picked.requestCount += 1;
    return picked;
  }

  private availableEntries(): PooledCredential[] {
    const now = Date.now();
    const out: PooledCredential[] = [];
    for (const entry of this.entries) {
      if (entry.lastStatus === "ok") {
        out.push(entry);
        continue;
      }
      // EC-1: auto-heal expired cooldowns inline.
      const resetAt = entry.lastErrorResetAt;
      if (resetAt !== undefined && now >= resetAt) {
        entry.lastStatus = "ok";
        entry.lastStatusAt = undefined;
        entry.lastErrorCode = undefined;
        entry.lastErrorResetAt = undefined;
        out.push(entry);
      }
    }
    return out;
  }
}

/**
 * Drop duplicates by `accessToken`. Keeps the first occurrence (lowest
 * priority wins after sort). EC-C from the edge-case review.
 */
function dedupeByToken(entries: PooledCredential[]): PooledCredential[] {
  const seen = new Set<string>();
  const out: PooledCredential[] = [];
  for (const e of entries) {
    if (seen.has(e.accessToken)) continue;
    seen.add(e.accessToken);
    out.push(e);
  }
  return out;
}
