/**
 * M95 Phase 2 — the lease is actually **wired**.
 *
 * `acquireSessionWriter` has existed since M81 and had **zero** production callers — measured by
 * grep: only the definition and the re-export in `persistence.ts`. The single-writer guarantee was
 * written and switched off from the day it was written, and the roadmap recorded it as delivered. It is the
 * worst kind of debt: the kind that presents itself as coverage.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import { transcriptPath } from "../src/internal/persistence/session-transcript.js";
import { SessionBusyError } from "../src/internal/persistence/session-writer.js";
import type { SessionRecord } from "../src/types/session-record.js";

const abertos: FsSessionStore[] = [];
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.dispose();
});

const registro = (uuid: string): SessionRecord => ({
  type: "user",
  uuid,
  parentUuid: null,
  sessionId: "s",
  timestamp: new Date(0).toISOString(),
});

function novoStore(baseDir: string): FsSessionStore {
  const s = new FsSessionStore({ baseDir, cwd: "/algum/cwd" });
  abertos.push(s);
  return s;
}

describe("M95 — the lease is wired", () => {
  it("acquire() toma o lease", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = novoStore(base);
    await store.acquire("ag");
    expect(existsSync(`${transcriptPath(base, "/algum/cwd", "ag")}.writer.lock`)).toBe(true);
  });

  it("appendRecords NEVER throws SessionBusyError — the turn does not vanish silently", async () => {
    // BLOCKER-1 from adversarial review. The `SessionStore` contract says an append rejection is
    // best-effort: "logged to stderr, NOT thrown to the caller". Adquirir o lease ali fazia o
    // SessionBusyError ser ENGOLIDO, e o perdedor perdia o turno inteiro sem nada em disco e sem
    // como reagir — pior que o problema original, que era intercalar linhas.
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const path = transcriptPath(base, "/algum/cwd", "ag");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      `${path}.writer.lock`,
      JSON.stringify({ pid: process.ppid, hostname: hostname(), mtime: Date.now() }),
    );
    const store = novoStore(base);
    await expect(store.appendRecords("ag", [registro("b")])).resolves.toBeUndefined();
  });

  it("dispose libera o lease", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = new FsSessionStore({ baseDir: base, cwd: "/algum/cwd" });
    await store.acquire("ag");
    await store.dispose();
    expect(existsSync(`${transcriptPath(base, "/algum/cwd", "ag")}.writer.lock`)).toBe(false);
  });

  it("um OUTRO PROCESSO vivo segurando o lock produz SessionBusyError", async () => {
    // The lease protects against another PROCESS — two stores in the SAME process are a legitimate pattern
    // (the golden compaction tests do exactly that, and failed when the first version refused
    // its own owner). So a foreign owner is simulated by the parent process's pid: alive, and not us.
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const path = transcriptPath(base, "/algum/cwd", "ag");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      `${path}.writer.lock`,
      JSON.stringify({ pid: process.ppid, hostname: hostname(), mtime: Date.now() }),
    );
    const store = novoStore(base);
    await expect(store.acquire("ag")).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("reading does NOT acquire a lease — concurrent reads stay free", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = novoStore(base);
    await store.readRecords("ag");
    expect(existsSync(`${transcriptPath(base, "/algum/cwd", "ag")}.writer.lock`)).toBe(false);
  });

  it("dispose is idempotent", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = new FsSessionStore({ baseDir: base, cwd: "/algum/cwd" });
    await store.acquire("ag");
    await store.dispose();
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
