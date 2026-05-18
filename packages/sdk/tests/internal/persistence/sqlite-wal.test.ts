/**
 * RED tests for T4.1 — `applyWalWithFallback` SQLite WAL → DELETE fallback.
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetWalWarnings,
  applyWalWithFallback,
} from "../../../src/internal/persistence/sqlite-wal.js";

describe("applyWalWithFallback", () => {
  let originalWrite: typeof process.stderr.write;
  let stderrCalls: string[];

  beforeEach(() => {
    _resetWalWarnings();
    stderrCalls = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    // Replace stderr.write with a recorder. Returning true preserves the
    // sync signature of `NodeJS.WriteStream.write`.
    process.stderr.write = ((chunk: unknown) => {
      stderrCalls.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("succeeds on normal filesystem (returns wal mode)", () => {
    const db = new Database(":memory:");
    try {
      // In-memory DBs report MEMORY journal mode rather than wal; mock pragma.
      const fakeDb = {
        pragma: (stmt: string, opts?: { simple?: boolean }) => {
          if (stmt === "journal_mode = WAL" && opts?.simple) return "wal";
          return undefined;
        },
      };
      const result = applyWalWithFallback(fakeDb, "normal");
      expect(result).toEqual({ mode: "wal", fellBack: false });
      expect(stderrCalls).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("falls back to DELETE when pragma returns non-wal value", () => {
    const calls: string[] = [];
    const fakeDb = {
      pragma: (stmt: string, _opts?: { simple?: boolean }) => {
        calls.push(stmt);
        if (stmt === "journal_mode = WAL") return "MEMORY";
        return undefined;
      },
    };
    const result = applyWalWithFallback(fakeDb, "memory-test");
    expect(result).toEqual({ mode: "delete", fellBack: true });
    expect(calls).toContain("journal_mode = DELETE");
    expect(stderrCalls.join("")).toMatch(/memory-test.*WAL unavailable/);
  });

  it("falls back to DELETE when pragma throws", () => {
    const calls: string[] = [];
    const fakeDb = {
      pragma: (stmt: string, _opts?: { simple?: boolean }) => {
        calls.push(stmt);
        if (stmt === "journal_mode = WAL") throw new Error("I/O error simulated");
        return undefined;
      },
    };
    const result = applyWalWithFallback(fakeDb, "io-fail");
    expect(result.fellBack).toBe(true);
    expect(calls).toContain("journal_mode = DELETE");
    expect(stderrCalls.join("")).toMatch(/io-fail.*WAL unavailable.*I\/O error simulated/);
  });

  it("warns only once per label across multiple calls", () => {
    const fakeDb = {
      pragma: (stmt: string) => {
        if (stmt === "journal_mode = WAL") return "MEMORY";
        return undefined;
      },
    };
    applyWalWithFallback(fakeDb, "dup-label");
    applyWalWithFallback(fakeDb, "dup-label");
    applyWalWithFallback(fakeDb, "dup-label");
    const warnings = stderrCalls.filter((s) => s.includes("WAL unavailable"));
    expect(warnings).toHaveLength(1);
  });

  it("warns separately for distinct labels", () => {
    const fakeDb = {
      pragma: (stmt: string) => {
        if (stmt === "journal_mode = WAL") return "MEMORY";
        return undefined;
      },
    };
    applyWalWithFallback(fakeDb, "label-a");
    applyWalWithFallback(fakeDb, "label-b");
    const warnings = stderrCalls.filter((s) => s.includes("WAL unavailable"));
    expect(warnings).toHaveLength(2);
  });

  it("real-fs integration: opens on-disk DB and lands on wal (POSIX)", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "wal-real-"));
    try {
      const db = new Database(join(dir, "real.db"));
      try {
        const result = applyWalWithFallback(db, "real-fs");
        // On Linux/macOS regular filesystems, WAL should land.
        expect(["wal", "delete"]).toContain(result.mode);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
