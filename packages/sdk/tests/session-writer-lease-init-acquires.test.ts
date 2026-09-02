/**
 * M95 — the BLOCKER-1 fix must be distinguishable from its absence.
 *
 * Adversarial review measured that deleting the init acquisition **and** the propagation of
 * `SessionBusyError` left the whole suite green: 3960/3960. It is the same kind of debt that opened
 * this milestone — `acquireSessionWriter` with zero callers while the roadmap recorded it as
 * delivered — now in the fix for the BLOCKER it came to close.
 *
 * These tests are the ones that fail both mutants.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { LocalAgent } from "../src/internal/local-agent/local-agent.js";
import { transcriptPath } from "../src/internal/persistence/session-transcript.js";
import { SessionBusyError } from "../src/internal/persistence/session-writer.js";
import type { AgentOptions } from "../src/types/agent.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

const created: LocalAgent[] = [];
afterEach(async () => {
  for (const a of created.splice(0)) await a.dispose();
});

function options(baseDir: string, agentId: string): AgentOptions {
  return {
    agentId,
    apiKey: "theo_test_m95",
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: baseDir, baseDir },
  } as unknown as AgentOptions;
}

async function makeAgent(baseDir: string, agentId: string): Promise<LocalAgent> {
  const a = new LocalAgent(options(baseDir, agentId));
  created.push(a);
  await a.initialize();
  return a;
}

/** A `.writer.lock` owned by a live, foreign owner — the parent process's pid. */
function lockFromAnotherProcess(baseDir: string, agentId: string): string {
  const p = transcriptPath(baseDir, baseDir, agentId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(
    `${p}.writer.lock`,
    JSON.stringify({ pid: process.ppid, hostname: hostname(), mtime: Date.now() }),
  );
  return p;
}

describe("M95 — init takes the lease (mutant N1)", () => {
  it("after initialize(), the lock exists", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const __baseCleanup1 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup1);
    });
    await makeAgent(base, "ag-n1");
    expect(existsSync(`${transcriptPath(base, base, "ag-n1")}.writer.lock`)).toBe(true);
  });

  it("dispose() releases the lock", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const __baseCleanup2 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup2);
    });
    const a = new LocalAgent(options(base, "ag-n1b"));
    await a.initialize();
    await a.dispose();
    expect(existsSync(`${transcriptPath(base, base, "ag-n1b")}.writer.lock`)).toBe(false);
  });
});

describe("M95 — SessionBusyError PROPAGATES from init (mutant N2)", () => {
  it("initialize() throws when another live process holds the session", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const __baseCleanup3 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup3);
    });
    lockFromAnotherProcess(base, "ag-n2");
    const a = new LocalAgent(options(base, "ag-n2"));
    created.push(a);
    await expect(a.initialize()).rejects.toBeInstanceOf(SessionBusyError);
  });
});

describe("M95 — an init that fails AFTER acquiring releases the lease (HIGH-1)", () => {
  it("the lock is not left with this very process, which would lock it forever", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const __baseCleanup4 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup4);
    });
    const p = transcriptPath(base, base, "ag-h1");
    mkdirSync(dirname(p), { recursive: true });
    // Unreadable transcript: `readRecords` MUST throw by contract ("a resume cannot proceed on a
    // silent partial history"), and that happens AFTER the acquisition.
    writeFileSync(p, "content", { mode: 0o000 });

    const a = new LocalAgent(options(base, "ag-h1"));
    await a.initialize().catch(() => undefined);

    // If the lease leaks, it stays with THIS process — alive, same host — and is never reclaimable again.
    expect(
      existsSync(`${p}.writer.lock`),
      "the lease leaked: the session stays locked for the process lifetime",
    ).toBe(false);
  });
});

describe("M95/LOW-1 — a failing init does not release OTHER agents' leases", () => {
  it("a live agent's lease survives another agent's init failure", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const __baseCleanup5 = base;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseCleanup5);
    });
    const live = await makeAgent(base, "ag-live");
    expect(existsSync(`${transcriptPath(base, base, "ag-live")}.writer.lock`)).toBe(true);

    // A second agent IN THE SAME store fails at init after acquiring.
    const p = transcriptPath(base, base, "ag-fails");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "x", { mode: 0o000 });
    const b = new LocalAgent({
      ...(options(base, "ag-fails") as object),
      local: {
        cwd: base,
        baseDir: base,
        sessionStore: (live as unknown as { sessionStore: unknown }).sessionStore,
      },
    } as never);
    await b.initialize().catch(() => undefined);

    expect(
      existsSync(`${transcriptPath(base, base, "ag-live")}.writer.lock`),
      "one agent's failure released another's lease, which is still writing",
    ).toBe(true);
  });
});
