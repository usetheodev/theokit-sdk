/**
 * Tests for CredentialPool (T1.1, ADRs D123-D133).
 *
 * Covers all 4 strategies, exhaustion + auto-heal, mutex serialization,
 * dedupe (EC-C), and constructor validation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { CredentialPool, newPooledCredential } from "../../../src/internal/llm/credential-pool.js";

function makeEntries(provider: string, tokens: string[]): ReturnType<typeof newPooledCredential>[] {
  return tokens.map((t, i) =>
    newPooledCredential({ provider, accessToken: t, priority: i, source: `manual:${i}` }),
  );
}

describe("CredentialPool (T1.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fill_first: returns entries[0] until exhausted", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k2"]),
      "fill_first",
    );
    const a = await pool.select();
    const b = await pool.select();
    expect(a?.accessToken).toBe("k1");
    expect(b?.accessToken).toBe("k1");
  });

  it("select returns null when all entries exhausted", async () => {
    const pool = new CredentialPool("openrouter", makeEntries("openrouter", ["k1"]), "fill_first");
    const a = await pool.select();
    expect(a).not.toBeNull();
    await pool.markExhaustedAndRotate({ entryId: a!.id, statusCode: 429 });
    const b = await pool.select();
    expect(b).toBeNull();
  });

  it("auto-heals after cooldown expires", async () => {
    const pool = new CredentialPool("openrouter", makeEntries("openrouter", ["k1"]), "fill_first");
    const a = await pool.select();
    await pool.markExhaustedAndRotate({ entryId: a!.id, statusCode: 429 });
    expect(await pool.select()).toBeNull();
    // Fast-forward past 1h 429 cooldown
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    const healed = await pool.select();
    expect(healed?.accessToken).toBe("k1");
    expect(healed?.lastStatus).toBe("ok");
  });

  it("round_robin: rotates entries in order", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["a", "b", "c"]),
      "round_robin",
    );
    const picks = [
      (await pool.select())?.accessToken,
      (await pool.select())?.accessToken,
      (await pool.select())?.accessToken,
    ];
    expect(picks).toEqual(["a", "b", "c"]);
  });

  it("round_robin: 1 entry behaves like fill_first", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["solo"]),
      "round_robin",
    );
    expect((await pool.select())?.accessToken).toBe("solo");
    expect((await pool.select())?.accessToken).toBe("solo");
  });

  it("least_used: picks min requestCount", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k2"]),
      "least_used",
    );
    const first = await pool.select(); // k1 count=1
    const second = await pool.select(); // k2 count=1 (tie-break by priority)
    expect(first?.accessToken).toBe("k1");
    expect(second?.accessToken).toBe("k2");
    const third = await pool.select(); // both at 1; tie-break → k1 wins
    expect(third?.accessToken).toBe("k1");
  });

  it("least_used: breaks tie by priority", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["a", "b"]),
      "least_used",
    );
    expect((await pool.select())?.accessToken).toBe("a"); // both 0 → priority 0 wins
  });

  it("random: only picks healthy entries", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k2"]),
      "random",
    );
    const a = (await pool.select())!;
    await pool.markExhaustedAndRotate({ entryId: a.id, statusCode: 429 });
    // Force several picks; all must avoid the exhausted one.
    for (let i = 0; i < 10; i += 1) {
      const picked = await pool.select();
      expect(picked?.accessToken).not.toBe(a.accessToken);
    }
  });

  it("mark exhausted uses 401 cooldown = 5 minutes", async () => {
    const pool = new CredentialPool("openrouter", makeEntries("openrouter", ["k1"]), "fill_first");
    const a = (await pool.select())!;
    await pool.markExhaustedAndRotate({ entryId: a.id, statusCode: 401 });
    vi.advanceTimersByTime(5 * 60 * 1000 - 100);
    expect(await pool.select()).toBeNull(); // still in cooldown
    vi.advanceTimersByTime(200);
    expect(await pool.select()).not.toBeNull(); // healed
  });

  it("mark exhausted uses 429 cooldown = 1 hour", async () => {
    const pool = new CredentialPool("openrouter", makeEntries("openrouter", ["k1"]), "fill_first");
    const a = (await pool.select())!;
    await pool.markExhaustedAndRotate({ entryId: a.id, statusCode: 429 });
    vi.advanceTimersByTime(60 * 60 * 1000 - 100);
    expect(await pool.select()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(await pool.select()).not.toBeNull();
  });

  it("mark exhausted uses 402 cooldown = 1 hour", async () => {
    const pool = new CredentialPool("openrouter", makeEntries("openrouter", ["k1"]), "fill_first");
    const a = (await pool.select())!;
    await pool.markExhaustedAndRotate({ entryId: a.id, statusCode: 402 });
    vi.advanceTimersByTime(60 * 60 * 1000 - 100);
    expect(await pool.select()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(await pool.select()).not.toBeNull();
  });

  it("honors provider resetAtMs override", async () => {
    const pool = new CredentialPool("openrouter", makeEntries("openrouter", ["k1"]), "fill_first");
    const a = (await pool.select())!;
    const customReset = Date.now() + 1000; // 1 second
    await pool.markExhaustedAndRotate({ entryId: a.id, statusCode: 429, resetAtMs: customReset });
    vi.advanceTimersByTime(500);
    expect(await pool.select()).toBeNull();
    vi.advanceTimersByTime(600);
    expect(await pool.select()).not.toBeNull(); // honored 1s, not 1h default
  });

  it("concurrent select serializes via mutex", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k2", "k3"]),
      "round_robin",
    );
    const picks = await Promise.all([pool.select(), pool.select(), pool.select()]);
    const tokens = picks.map((p) => p?.accessToken);
    expect(new Set(tokens).size).toBe(3); // all distinct
  });

  it("throws on empty constructor input", () => {
    expect(() => new CredentialPool("openrouter", [])).toThrow(ConfigurationError);
  });

  // EC-C: dedupe identical access tokens
  it("dedupes identical accessTokens", () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k1", "k2"]),
      "fill_first",
    );
    expect(pool.list().length).toBe(2);
    expect(pool.list().map((e) => e.accessToken)).toEqual(["k1", "k2"]);
  });

  it("resetAll clears all cooldowns", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k2"]),
      "fill_first",
    );
    const a = (await pool.select())!;
    await pool.markExhaustedAndRotate({ entryId: a.id, statusCode: 429 });
    await pool.resetAll();
    expect(pool.list().every((e) => e.lastStatus === "ok")).toBe(true);
  });

  it("toSnapshot + fromSnapshot round-trips entry state", async () => {
    const pool = new CredentialPool(
      "openrouter",
      makeEntries("openrouter", ["k1", "k2"]),
      "round_robin",
    );
    await pool.select();
    const snap = pool.toSnapshot();
    const restored = CredentialPool.fromSnapshot(snap);
    expect(restored.list().map((e) => e.accessToken)).toEqual(
      snap.entries.map((e) => e.accessToken),
    );
  });
});
