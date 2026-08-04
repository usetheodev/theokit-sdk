/**
 * M95 — the BLOCKER-1 fix must be distinguishable from its absence.
 *
 * Adversarial review measured that deleting the init acquisition **and** the propagation of
 * `SessionBusyError` left the whole suite green: 3960/3960. It is the same kind of debt that opened
 * este milestone — `acquireSessionWriter` com zero chamadores enquanto o roadmap a registrava como
 * delivered — now in the fix for the BLOCKER it came to close.
 *
 * These tests are the ones that fail both mutants.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../src/internal/local-agent/local-agent.js";
import { transcriptPath } from "../src/internal/persistence/session-transcript.js";
import { SessionBusyError } from "../src/internal/persistence/session-writer.js";
import type { AgentOptions } from "../src/types/agent.js";

const criados: LocalAgent[] = [];
afterEach(async () => {
  for (const a of criados.splice(0)) await a.dispose();
});

function opcoes(baseDir: string, agentId: string): AgentOptions {
  return {
    agentId,
    apiKey: "theo_test_m95",
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: baseDir, baseDir },
  } as unknown as AgentOptions;
}

async function agente(baseDir: string, agentId: string): Promise<LocalAgent> {
  const a = new LocalAgent(opcoes(baseDir, agentId));
  criados.push(a);
  await a.initialize();
  return a;
}

/** Um `.writer.lock` de dono vivo e alheio — o pid do processo pai. */
function lockDeOutroProcesso(baseDir: string, agentId: string): string {
  const p = transcriptPath(baseDir, baseDir, agentId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(
    `${p}.writer.lock`,
    JSON.stringify({ pid: process.ppid, hostname: hostname(), mtime: Date.now() }),
  );
  return p;
}

describe("M95 — o init toma o lease (mutante N1)", () => {
  it("depois de initialize(), o lock existe", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    await agente(base, "ag-n1");
    expect(existsSync(`${transcriptPath(base, base, "ag-n1")}.writer.lock`)).toBe(true);
  });

  it("dispose() solta o lock", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const a = new LocalAgent(opcoes(base, "ag-n1b"));
    await a.initialize();
    await a.dispose();
    expect(existsSync(`${transcriptPath(base, base, "ag-n1b")}.writer.lock`)).toBe(false);
  });
});

describe("M95 — SessionBusyError PROPAGA do init (mutante N2)", () => {
  it("initialize() throws when another live process holds the session", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    lockDeOutroProcesso(base, "ag-n2");
    const a = new LocalAgent(opcoes(base, "ag-n2"));
    criados.push(a);
    await expect(a.initialize()).rejects.toBeInstanceOf(SessionBusyError);
  });
});

describe("M95 — um init que falha DEPOIS de adquirir solta o lease (HIGH-1)", () => {
  it("the lock is not left with this very process, which would lock it forever", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const p = transcriptPath(base, base, "ag-h1");
    mkdirSync(dirname(p), { recursive: true });
    // Unreadable transcript: `readRecords` MUST throw by contract ("a resume cannot proceed on a
    // silent partial history"), and that happens AFTER the acquisition.
    writeFileSync(p, "conteudo", { mode: 0o000 });

    const a = new LocalAgent(opcoes(base, "ag-h1"));
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
    const vivo = await agente(base, "ag-vivo");
    expect(existsSync(`${transcriptPath(base, base, "ag-vivo")}.writer.lock`)).toBe(true);

    // Um segundo agente NO MESMO store falha no init depois de adquirir.
    const p = transcriptPath(base, base, "ag-falha");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "x", { mode: 0o000 });
    const b = new LocalAgent({
      ...(opcoes(base, "ag-falha") as object),
      local: {
        cwd: base,
        baseDir: base,
        sessionStore: (vivo as unknown as { sessionStore: unknown }).sessionStore,
      },
    } as never);
    await b.initialize().catch(() => undefined);

    expect(
      existsSync(`${transcriptPath(base, base, "ag-vivo")}.writer.lock`),
      "a falha de um agente liberou o lease de outro, que segue escrevendo",
    ).toBe(true);
  });
});
