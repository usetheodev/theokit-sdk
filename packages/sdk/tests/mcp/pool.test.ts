/**
 * M77 T3.1 — the MCP client stops being recreated on every turn.
 *
 * ## The measured cost
 *
 * `real-local-run.ts:349` calls `createMcpClient` inside `buildMcpMap`, which runs **per run**.
 * Every `send` redoes the server's spawn + handshake: 193 / 138 / 134 ms per turn, measured.
 *
 * ## What the single reference does
 *
 * Codex anchors `McpConnectionManager` in `SessionServices` (`core/src/state/service.rs:116`) — the
 * same struct whose neighboring field carries the comment *"Session-scoped model client shared across
 * turns"* — and **replaces** the runtime (`service.rs:136`, `self.mcp_runtime.replace(connections)`) on
 * instead of rebuilding it. The path that builds and immediately destroys
 * (`core/src/connectors.rs:245` ... `:334 shutdown()`) is one-shot connector discovery, not the turn
 * loop; conflating the two would lead to the opposite conclusion.
 *
 * ## Why the key includes the config HASH
 *
 * `sendOptions.mcpServers` **replaces** `agentOptions.mcpServers` (semantics documented in the docblock
 * of `resolveTools`). Two runs in the same session can legitimately ask for the same server NAME
 * with different configuration. Keying only by `(session, name)` would return a client connected to the
 * wrong server — a wrong answer, not an error.
 *
 * ## Why `'run'` remains the default
 *
 * Keeping clients alive across turns changes the failure model: a server dying mid-session
 * is now a reachable state. Cron and one-shot gain nothing from the pool and would pay that risk, so
 * the `'session'` mode is opt-in (plan ADR D3).
 */
import { describe, expect, it } from "vitest";

import { McpClientPool } from "../../src/internal/local-agent/mcp-pool.js";

/** Minimal double: it only needs to record that it was closed. */
interface FakeClient {
  readonly id: number;
  closed: boolean;
  close: () => void;
}

function countedFactory(): { create: () => FakeClient; calls: () => number } {
  let n = 0;
  return {
    create: () => {
      n += 1;
      const c: FakeClient = { id: n, closed: false, close: () => (c.closed = true) };
      return c;
    },
    calls: () => n,
  };
}

const CFG = { command: "node", args: ["server.js"] };

describe("M77 T3.1 — per-session MCP client pool", () => {
  it("test_a_second_turn_of_the_SAME_session_REUSES_the_client", () => {
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>();

    const a = pool.acquire("session-1", "fs", CFG, f.create);
    const b = pool.acquire("session-1", "fs", CFG, f.create);

    // Counting CAUSE: it proves the factory did not run again, not merely that the objects match.
    expect(f.calls(), "the second turn must not respawn the server").toBe(1);
    expect(b).toBe(a);
  });

  it("test_distinct_sessions_do_NOT_share_a_client", () => {
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>();

    const a = pool.acquire("session-1", "fs", CFG, f.create);
    const b = pool.acquire("session-2", "fs", CFG, f.create);

    // Sharing across sessions would leak state from one conversation into another.
    expect(f.calls()).toBe(2);
    expect(b).not.toBe(a);
  });

  it("test_a_different_config_in_the_same_session_creates_ANOTHER_client", () => {
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>();

    pool.acquire("session-1", "fs", CFG, f.create);
    pool.acquire("session-1", "fs", { command: "node", args: ["OTHER.js"] }, f.create);

    // Without the hash in the key, the second `acquire` would return a client bound to the WRONG server.
    expect(f.calls(), "same name + different config => different client").toBe(2);
  });

  it("test_COUNTERPROOF_config_key_order_does_not_change_identity", () => {
    // Without this one, the hash could be a raw `JSON.stringify` — and `{a,b}` vs `{b,a}` would produce different
    // distinct for IDENTICAL configurations, respawning every turn and silently nullifying the pool.
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>();

    pool.acquire("s", "fs", { command: "node", args: ["x"] }, f.create);
    pool.acquire("s", "fs", { args: ["x"], command: "node" }, f.create);

    expect(f.calls()).toBe(1);
  });

  it("test_session_dispose_CLOSES_the_clients_and_frees_the_key", () => {
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>();

    const a = pool.acquire("session-1", "fs", CFG, f.create);
    const b = pool.acquire("session-1", "git", CFG, f.create);
    pool.disposeSession("session-1", (c) => c.close());

    expect(a.closed, "a leaked client is a leaked process").toBe(true);
    expect(b.closed).toBe(true);

    // And the key goes away: a subsequent `acquire` must create anew, not return the closed one.
    pool.acquire("session-1", "fs", CFG, f.create);
    expect(f.calls()).toBe(3);
  });

  it("test_disposing_one_session_does_NOT_touch_the_other", () => {
    // COUNTERPROOF: without it, a `disposeSession` that cleared the whole Map would pass the test above and
    // tear down the servers of every concurrent conversation.
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>();

    const a = pool.acquire("session-1", "fs", CFG, f.create);
    const b = pool.acquire("session-2", "fs", CFG, f.create);
    pool.disposeSession("session-1", (c) => c.close());

    expect(a.closed).toBe(true);
    expect(b.closed, "the neighboring session must not be torn down with it").toBe(false);
  });

  it("test_the_idle_TTL_closes_a_client_that_stopped", () => {
    // INJECTED clock — `rules/testing.md` § 6 forbids real time in a unit test. Without the TTL, a
    // long session that used a server once keeps it alive until dispose.
    let now = 1_000;
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>({ idleTtlMs: 500, now: () => now });

    const a = pool.acquire("s", "fs", CFG, f.create);
    now += 501;
    pool.reapIdle((c) => c.close());

    expect(a.closed).toBe(true);
    // And the key is gone: the next acquire creates instead of returning a dead client.
    pool.acquire("s", "fs", CFG, f.create);
    expect(f.calls()).toBe(2);
  });

  it("test_COUNTERPROOF_recent_use_is_NOT_collected", () => {
    // Without this one, a `reapIdle` that closed everything would pass the TTL test and kill the client that
    // was just used — the worst possible outcome, worse than having no pool.
    let now = 1_000;
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>({ idleTtlMs: 500, now: () => now });

    const a = pool.acquire("s", "fs", CFG, f.create);
    now += 400;
    pool.reapIdle((c) => c.close());

    expect(a.closed).toBe(false);
  });

  it("test_acquire_RENEWS_the_idle_clock", () => {
    // The TTL is about IDLENESS, not lifetime. A server used every turn must not be collected just
    // because it was created long ago.
    let now = 1_000;
    const f = countedFactory();
    const pool = new McpClientPool<FakeClient>({ idleTtlMs: 500, now: () => now });

    const a = pool.acquire("s", "fs", CFG, f.create);
    now += 400;
    pool.acquire("s", "fs", CFG, f.create); // use — renews
    now += 400; // 800 since creation, 400 since last use
    pool.reapIdle((c) => c.close());

    expect(a.closed, "the TTL is about idleness; use renews it").toBe(false);
  });
});
