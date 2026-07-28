/**
 * M95 — a correção do BLOCKER-1 tem de ser distinguível da sua ausência.
 *
 * A revisão adversarial mediu que apagar a aquisição no init **e** a propagação do
 * `SessionBusyError` deixava a suíte inteira verde: 3960/3960. É a mesma forma de dívida que abriu
 * este milestone — `acquireSessionWriter` com zero chamadores enquanto o roadmap a registrava como
 * entregue —, agora na correção do BLOCKER que ela veio fechar.
 *
 * Estes testes são os que reprovam os dois mutantes.
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
  it("initialize() lança quando outro processo vivo detém a sessão", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    lockDeOutroProcesso(base, "ag-n2");
    const a = new LocalAgent(opcoes(base, "ag-n2"));
    criados.push(a);
    await expect(a.initialize()).rejects.toBeInstanceOf(SessionBusyError);
  });
});

describe("M95 — um init que falha DEPOIS de adquirir solta o lease (HIGH-1)", () => {
  it("o lock não fica com o próprio processo, que o trancaria para sempre", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-init-"));
    const p = transcriptPath(base, base, "ag-h1");
    mkdirSync(dirname(p), { recursive: true });
    // Transcript ilegível: `readRecords` DEVE lançar por contrato ("a resume cannot proceed on a
    // silent partial history"), e isso acontece DEPOIS da aquisição.
    writeFileSync(p, "conteudo", { mode: 0o000 });

    const a = new LocalAgent(opcoes(base, "ag-h1"));
    await a.initialize().catch(() => undefined);

    // Se o lease vazar, ele fica com ESTE processo — vivo, mesmo host — e nunca mais é reclamável.
    expect(
      existsSync(`${p}.writer.lock`),
      "o lease vazou: a sessão fica trancada pelo tempo de vida do processo",
    ).toBe(false);
  });
});
