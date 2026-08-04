/**
 * M81 T1.2 — single-writer lease for a session.
 *
 * ## O problema medido
 *
 * Nada impede hoje que dois processos anexem ao mesmo transcript JSONL. O caso concreto que o M81
 * cites: `exec resume --last` can write into the TUI's live session. Two interleaved writes in an
 * append-only file produce a file whose lines are individually valid and whose SEQUENCE is
 * fiction — and nothing flags it, because each line parses on its own.
 *
 * ## The plan's ADR D2 said "composes `withFileLock`", and the implementation diverged — with the reason written down
 *
 * D2's instinct was right: do not build a second locking mechanism. What did not fit was the
 * SHAPE. `withFileLock(path, fn)` is scope-based — it holds the lock for a callback's duration.
 * A session lease is held **across turns**, for as long as the process owns the session, with an
 * explicit `release()`. Wrapping the session's whole lifecycle in a callback would invert the
 * controle do agent loop.
 *
 * The implementation uses the SAME primitive `withFileLock` uses underneath — an exclusive-creation
 * lockfile (`wx`) — with lease semantics on top. The mechanism stays single; only its lifetime changed.
 * The divergence is recorded in the source, not hidden.
 *
 * ## Fails FAST, does not wait
 *
 * A second writer waiting for the lease would block `exec` behind a TUI session that can
 * last hours. `rules/error-handling.md` § 2 asks for a typed error; here it also has to be immediate,
 * para o chamador poder decidir entre forkar e desistir.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  acquireSessionWriter,
  SessionBusyError,
} from "../src/internal/persistence/session-writer.js";

const dir = mkdtempSync(join(tmpdir(), "m81-lease-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sessao = (nome: string): string => join(dir, `${nome}.jsonl`);

describe("M81 T1.2 — session writer lease", () => {
  it("test_o_primeiro_escritor_obtem_o_lease", async () => {
    const lease = await acquireSessionWriter(sessao("a"));
    expect(lease).toBeDefined();
    await lease.release();
  });

  it("test_o_segundo_FALHA_RAPIDO_com_erro_tipado", async () => {
    // Waiting would block `exec` behind a TUI session that can last hours. The typed error lets
    // the caller choose: fork to a new id, or give up with a diagnostic.
    const primeiro = await acquireSessionWriter(sessao("b"));
    const start = Date.now();

    await expect(acquireSessionWriter(sessao("b"))).rejects.toBeInstanceOf(SessionBusyError);
    expect(Date.now() - start, "must fail fast, not wait for the lease").toBeLessThan(2000);

    await primeiro.release();
  });

  it("test_liberar_o_lease_permite_o_proximo", async () => {
    const primeiro = await acquireSessionWriter(sessao("c"));
    await primeiro.release();

    // Sem isto, o lease seria uma trava permanente em vez de um lease.
    const segundo = await acquireSessionWriter(sessao("c"));
    expect(segundo).toBeDefined();
    await segundo.release();
  });

  it("test_CONTRAPROVA_sessoes_distintas_nao_disputam", async () => {
    // Without this, a global lease would pass the tests above and serialize EVERY session — the
    // opposite of the goal, and invisible until someone runs two agents at once.
    const a = await acquireSessionWriter(sessao("d1"));
    const b = await acquireSessionWriter(sessao("d2"));

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    await a.release();
    await b.release();
  });

  it("test_duas_aquisicoes_concorrentes_so_uma_vence", async () => {
    // Concurrent test with an atomic-counter invariant: `Promise.allSettled` of two acquisitions =>
    // exatamente 1 `fulfilled` e 1 `rejected`. Um lease que deixasse as duas passarem seria
    // decorative — and that is precisely today's state, with no lease at all.
    const p = sessao("e");
    const r = await Promise.allSettled([acquireSessionWriter(p), acquireSessionWriter(p)]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);

    for (const x of r) {
      if (x.status === "fulfilled") await x.value.release();
    }
  });

  it("test_o_erro_nomeia_a_sessao_disputada", async () => {
    // `error-handling.md` § 2: enough context to act. Knowing WHICH session is busy is what
    // lets the caller decide between forking and waiting for the user to close the TUI.
    const p = sessao("f");
    const primeiro = await acquireSessionWriter(p);
    const err = (await acquireSessionWriter(p).catch((e: unknown) => e)) as SessionBusyError;

    expect(err.sessionPath).toBe(p);
    expect(err.message).toContain(p);
    await primeiro.release();
  });
});
