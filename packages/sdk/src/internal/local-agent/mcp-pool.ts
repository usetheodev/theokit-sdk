/**
 * M77 — session-scoped MCP client pool.
 *
 * `buildMcpMap` (`real-local-run.ts`) builds a fresh `McpClient` on every run, so each `send` pays
 * spawn + handshake again: 193 / 138 / 134 ms per turn, measured. The runtime is therefore anchored at
 * the session and REPLACED rather than rebuilt.
 *
 * theokit#155: pooling the client OBJECT was never enough — the turn also has to stop closing what
 * it does not own. See `runOwnsMcpClients` (`real-local-run.ts`) and the idempotent
 * `StdioMcpClient.initialize()`.
 *
 * Generic over the client type on purpose: this file knows about keys, reuse and idleness, and
 * nothing about MCP. That keeps it unit-testable without spawning a server, and keeps `McpClient`'s
 * reconnect machinery (`internal/mcp/client.ts:165-171` — `dropped` + a single shared
 * `reconnectPromise` with full-jitter backoff) exactly where it already lives. The pool must not
 * reimplement surviving a dead server; it must not throw that capability away either.
 *
 * @internal
 */

/** Options for {@link McpClientPool}. */
export interface McpClientPoolOptions {
  /**
   * Milliseconds a client may sit unused before {@link McpClientPool.reapIdle} closes it. The clock
   * is idle-based, not lifetime-based: a server used every turn is never reaped.
   *
   * Default 10 minutes. Honest about provenance — no precedent for this number was found in the
   * reference; it is a conservative default chosen so a forgotten server does not outlive the
   * conversation by much, and it is written down rather than left implicit.
   */
  readonly idleTtlMs?: number;
  /** Injected clock — `rules/testing.md § 6` forbids real time in unit tests. */
  readonly now?: () => number;
}

interface Entry<C> {
  readonly client: C;
  readonly sessionId: string;
  lastUsedAt: number;
}

const DEFAULT_IDLE_TTL_MS = 600_000;

/**
 * Stable identity for a server config.
 *
 * Sorting the keys matters: `sendOptions.mcpServers` REPLACES `agentOptions.mcpServers`, so the same
 * server can be re-declared per run with its properties in a different order. A raw
 * `JSON.stringify` would hash `{a,b}` and `{b,a}` differently, quietly defeating reuse for
 * configurations that are in fact identical — the pool would look installed and do nothing.
 */
function configKey(config: unknown): string {
  return JSON.stringify(config, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

export class McpClientPool<C> {
  private readonly entries = new Map<string, Entry<C>>();
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(options: McpClientPoolOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Return the pooled client for `(sessionId, serverName, config)`, creating it via `factory` on
   * first use. Every call refreshes idleness — the TTL measures time SINCE LAST USE, not age.
   *
   * Synchronous by design: `createMcpClient` is itself synchronous (the handshake happens later, on
   * `initialize`), so there is no `await` between the lookup and the insert and two concurrent runs
   * in the same session cannot both miss the cache.
   */
  acquire(sessionId: string, serverName: string, config: unknown, factory: () => C): C {
    const key = `${sessionId}\u0000${serverName}\u0000${configKey(config)}`;
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.lastUsedAt = this.now();
      return existing.client;
    }
    const client = factory();
    this.entries.set(key, { client, sessionId, lastUsedAt: this.now() });
    return client;
  }

  /**
   * Close and forget every client of ONE session. Scoped deliberately: clearing the whole map would
   * tear down the servers of every concurrent conversation.
   */
  disposeSession(sessionId: string, close: (client: C) => void): void {
    for (const [key, entry] of this.entries) {
      if (entry.sessionId !== sessionId) continue;
      close(entry.client);
      this.entries.delete(key);
    }
  }

  /** Close and forget every client idle for longer than the TTL. */
  reapIdle(close: (client: C) => void): void {
    const cutoff = this.now() - this.idleTtlMs;
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt > cutoff) continue;
      close(entry.client);
      this.entries.delete(key);
    }
  }

  /** Live pooled-client count — for observability and tests. */
  size(): number {
    return this.entries.size;
  }
}
