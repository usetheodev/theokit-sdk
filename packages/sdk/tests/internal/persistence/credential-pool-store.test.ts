/**
 * Tests for credential-pool persistence (T2.1, ADRs D123, D129).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialPool, newPooledCredential } from "../../../src/internal/llm/credential-pool.js";
import type { CredentialPoolSnapshot } from "../../../src/internal/llm/credential-pool-types.js";
import {
  DebouncedPoolSaver,
  loadCredentialPoolStore,
  saveCredentialPoolStore,
} from "../../../src/internal/persistence/credential-pool-store.js";

describe("credential-pool persistence (T2.1)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pool-store-"));
    process.env.THEOKIT_HOME = join(cwd, ".theokit");
  });

  afterEach(() => {
    delete process.env.THEOKIT_HOME;
    rmSync(cwd, { recursive: true, force: true });
  });

  it("load returns empty Map when file missing (cold start)", async () => {
    const loaded = await loadCredentialPoolStore(cwd);
    expect(loaded.size).toBe(0);
  });

  it("save then load round-trips one provider", async () => {
    const pool = new CredentialPool(
      "openrouter",
      [
        newPooledCredential({
          provider: "openrouter",
          accessToken: "k1",
          priority: 0,
          source: "manual",
        }),
      ],
      "fill_first",
    );
    const map = new Map<string, CredentialPoolSnapshot>([["openrouter", pool.toSnapshot()]]);
    await saveCredentialPoolStore(cwd, map);
    const loaded = await loadCredentialPoolStore(cwd);
    expect(loaded.size).toBe(1);
    expect(loaded.get("openrouter")?.entries[0]?.accessToken).toBe("k1");
  });

  it("save then load preserves all fields", async () => {
    const pool = new CredentialPool(
      "openrouter",
      [
        newPooledCredential({
          provider: "openrouter",
          accessToken: "k1",
          priority: 0,
          source: "env:OPENROUTER_API_KEY",
        }),
      ],
      "round_robin",
    );
    await pool.select(); // bump requestCount
    const snap = pool.toSnapshot();
    await saveCredentialPoolStore(cwd, new Map([["openrouter", snap]]));
    const loaded = await loadCredentialPoolStore(cwd);
    const restored = loaded.get("openrouter")!;
    expect(restored.strategy).toBe("round_robin");
    expect(restored.entries[0]?.source).toBe("env:OPENROUTER_API_KEY");
    expect(restored.entries[0]?.requestCount).toBe(1);
  });

  it("save writes the v1 schema envelope", async () => {
    await saveCredentialPoolStore(cwd, new Map());
    const { readFileSync } = await import("node:fs");
    const path = join(cwd, ".theokit", "credential-pool.json");
    const text = readFileSync(path, "utf-8");
    const parsed = JSON.parse(text);
    expect(parsed._schemaVersion).toBe(1);
    expect(parsed.data).toEqual({ pools: {} });
  });

  it("load falls back to empty on corrupt JSON (writes stderr warn)", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = join(cwd, ".theokit");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credential-pool.json"), "{ not: valid json");
    const warn = vi.spyOn(process.stderr, "write");
    const loaded = await loadCredentialPoolStore(cwd);
    expect(loaded.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("concurrent saves serialize via file lock", async () => {
    const p1 = saveCredentialPoolStore(
      cwd,
      new Map([
        [
          "openrouter",
          new CredentialPool(
            "openrouter",
            [
              newPooledCredential({
                provider: "openrouter",
                accessToken: "a",
                priority: 0,
                source: "manual",
              }),
            ],
            "fill_first",
          ).toSnapshot(),
        ],
      ]),
    );
    const p2 = saveCredentialPoolStore(
      cwd,
      new Map([
        [
          "openrouter",
          new CredentialPool(
            "openrouter",
            [
              newPooledCredential({
                provider: "openrouter",
                accessToken: "b",
                priority: 0,
                source: "manual",
              }),
            ],
            "fill_first",
          ).toSnapshot(),
        ],
      ]),
    );
    await Promise.all([p1, p2]);
    const loaded = await loadCredentialPoolStore(cwd);
    const token = loaded.get("openrouter")?.entries[0]?.accessToken;
    expect(["a", "b"]).toContain(token); // one winner
  });

  // EC-F: round-robin priority order persists across save/load
  it("round_robin priority order survives save/load cycle", async () => {
    const pool = new CredentialPool(
      "openrouter",
      [
        newPooledCredential({
          provider: "openrouter",
          accessToken: "a",
          priority: 0,
          source: "manual",
        }),
        newPooledCredential({
          provider: "openrouter",
          accessToken: "b",
          priority: 1,
          source: "manual",
        }),
        newPooledCredential({
          provider: "openrouter",
          accessToken: "c",
          priority: 2,
          source: "manual",
        }),
      ],
      "round_robin",
    );
    await pool.select(); // a → tail
    await pool.select(); // b → tail
    await saveCredentialPoolStore(cwd, new Map([["openrouter", pool.toSnapshot()]]));

    const loaded = await loadCredentialPoolStore(cwd);
    const restored = CredentialPool.fromSnapshot(loaded.get("openrouter")!);
    expect((await restored.select())?.accessToken).toBe("c"); // continues rotation
  });

  // EC-E: debounced save tracks pending timeout
  it("debounced save replaces pending timeout (only 1 setTimeout outstanding)", async () => {
    vi.useFakeTimers();
    let saveCount = 0;
    const snapshots = new Map<string, CredentialPoolSnapshot>([
      [
        "openrouter",
        new CredentialPool(
          "openrouter",
          [
            newPooledCredential({
              provider: "openrouter",
              accessToken: "k",
              priority: 0,
              source: "manual",
            }),
          ],
          "fill_first",
        ).toSnapshot(),
      ],
    ]);
    const saver = new DebouncedPoolSaver(
      cwd,
      () => {
        saveCount += 1;
        return snapshots;
      },
      200,
    );
    saver.schedule();
    saver.schedule();
    saver.schedule();
    saver.schedule();
    saver.schedule();
    vi.advanceTimersByTime(199);
    expect(saveCount).toBe(0); // not fired yet
    vi.advanceTimersByTime(2);
    expect(saveCount).toBe(1); // exactly one save
    vi.useRealTimers();
  });

  it("flush forces immediate save", async () => {
    let saveCount = 0;
    const snapshots = new Map<string, CredentialPoolSnapshot>([
      [
        "openrouter",
        new CredentialPool(
          "openrouter",
          [
            newPooledCredential({
              provider: "openrouter",
              accessToken: "k",
              priority: 0,
              source: "manual",
            }),
          ],
          "fill_first",
        ).toSnapshot(),
      ],
    ]);
    const saver = new DebouncedPoolSaver(
      cwd,
      () => {
        saveCount += 1;
        return snapshots;
      },
      200,
    );
    saver.schedule();
    await saver.flush();
    expect(saveCount).toBe(1);
  });
});
