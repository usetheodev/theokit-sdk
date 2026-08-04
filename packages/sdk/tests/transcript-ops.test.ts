/**
 * M81 T1.1 — the transcript operations the consumer performed by hand inside the store.
 *
 * ## O que existe hoje, medido
 *
 * `agents/lib/session/backtrack.ts:188` (agent-builder) escreve assim:
 *
 * ```ts
 * writeFileSync(dst, body.length > 0 ? body + '\n' : '')
 * ```
 *
 * Escrita **crua** no store de transcripts do framework: sem atomicidade, sem lock, sem passar por
 * no API at all. That is 243 LoC reimplementing parsing, truncation and writing of a format the framework owns.
 *
 * ## A regra que viaja junto (ADR D3 do plano)
 *
 * `rules/audit-trail-rotation.md § Session transcripts (M60)` estabelece uma lista NEVER-delete:
 * o ponteiro vivo, o transcript mais recente, e qualquer entrada de registro ativa. Essa regra vive
 * today in the CONSUMER. Moving the operation into the framework without moving the rule would create an API able to
 * apagar exatamente o que a regra protege — o mesmo desenho que produziu `reconcileUpdateGoalStatus`
 * in M80: critical knowledge in the wrong place, enforced by convention.
 *
 * ## Why preserving the SOURCE is the most important assertion
 *
 * A fork that truncates the destination correctly but corrupts the source destroys the user's
 * session. It is the most dangerous operation in this milestone, and the one a "the destination is
 * right" test would not catch.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { loadJsonl } from "../src/internal/persistence/jsonl.js";
import {
  forkTranscript,
  LiveSessionError,
  readJsonlTail,
} from "../src/internal/persistence/transcript-ops.js";

const dir = mkdtempSync(join(tmpdir(), "m81-transcript-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Escreve um transcript de N registros e devolve o caminho. */
function escreverTranscript(nome: string, n: number): string {
  const p = join(dir, nome);
  writeFileSync(p, `${Array.from({ length: n }, (_, i) => JSON.stringify({ i })).join("\n")}\n`);
  return p;
}

describe("M81 T1.1 — transcript operations", () => {
  it("test_forkTranscript_PRESERVA_a_origem_intacta", () => {
    const src = escreverTranscript("origem.jsonl", 10);
    const antes = readFileSync(src, "utf8");

    forkTranscript(src, join(dir, "fork-a.jsonl"), { beforeRecordIndex: 4 });

    // The assertion that matters most: a fork that truncates correctly but corrupts the source
    // destroys the user's session, and a test focused only on the destination would not catch it.
    expect(readFileSync(src, "utf8"), "a origem tem de sobreviver byte a byte").toBe(antes);
  });

  it("test_forkTranscript_corta_no_beforeRecordIndex", () => {
    const src = escreverTranscript("origem2.jsonl", 10);
    const dst = join(dir, "fork-b.jsonl");

    forkTranscript(src, dst, { beforeRecordIndex: 4 });

    expect(loadJsonl(dst)).toHaveLength(4);
  });

  it("test_forkTranscript_RECUSA_sobrescrever_um_destino_existente", () => {
    // Overwriting silently is data loss without an error — the worst failure mode for an operation
    // that touches a user's session.
    const src = escreverTranscript("origem3.jsonl", 5);
    const dst = escreverTranscript("ja-existe.jsonl", 3);

    expect(() => forkTranscript(src, dst, { beforeRecordIndex: 2 })).toThrow();
    expect(loadJsonl(dst), "the existing destination must not have been touched").toHaveLength(3);
  });

  it("test_forkTranscript_RECUSA_escrever_sobre_o_ponteiro_vivo", () => {
    // M60's NEVER-delete list, now inside the framework (ADR D3). A TYPED error, not a generic one:
    // the caller needs to tell "protected session" from "disk full".
    const src = escreverTranscript("origem4.jsonl", 5);
    const vivo = escreverTranscript("sessao-viva.jsonl", 5);

    expect(() =>
      forkTranscript(src, vivo, { beforeRecordIndex: 2, liveSessionPaths: [vivo] }),
    ).toThrow(LiveSessionError);
  });

  it("test_readJsonlTail_devolve_os_ULTIMOS_registros", () => {
    const src = escreverTranscript("tail.jsonl", 100);
    const tail = readJsonlTail<{ i: number }>(src, { maxRecords: 3 });

    expect(tail).toHaveLength(3);
    expect(
      tail.map((r) => r.i),
      "must be the END, not the beginning",
    ).toEqual([97, 98, 99]);
  });

  it("test_readJsonlTail_le_de_TRAS_para_frente", () => {
    // The point of the operation: a long transcript must not be loaded whole to read its last
    // lines. Without this, `readJsonlTail` would be just a `slice` with a better name.
    // 40,000 records ~ 500 KB — several times the 64 KB chunk. With a fixture smaller than one
    // chunk, the first read would grab the whole file and the test would pass by accident of size,
    // not because the implementation is right.
    const src = escreverTranscript("grande.jsonl", 40_000);
    const bytesTotais = readFileSync(src).length;
    const { bytesRead } = readJsonlTail<{ i: number }>(src, {
      maxRecords: 2,
      _stats: true,
    }) as never;

    expect(bytesRead, "read the whole file — the backwards read is not happening").toBeLessThan(
      bytesTotais / 2,
    );
  });

  it("test_loadJsonl_tolera_linha_parcial_final", () => {
    // Artefato de crash: o processo morreu no meio de uma escrita. Os registros completos anteriores
    // remain valid and must be recoverable.
    const p = join(dir, "crash.jsonl");
    writeFileSync(p, `${JSON.stringify({ i: 1 })}\n${JSON.stringify({ i: 2 })}\n{"i":3`);

    const rec = loadJsonl(p, { tolerateTrailingPartialLine: true });
    expect(rec).toHaveLength(2);
  });

  it("test_CONTRAPROVA_loadJsonl_SEM_a_opcao_ainda_falha", () => {
    // The tolerance is opt-in. As a default, a file corrupted in the MIDDLE would go unnoticed —
    // and then the data loss would be silent instead of loud.
    const p = join(dir, "crash2.jsonl");
    writeFileSync(p, `${JSON.stringify({ i: 1 })}\n{"i":2`);

    expect(() => loadJsonl(p)).toThrow();
  });

  it("test_dois_forks_concorrentes_nao_corrompem_o_destino", async () => {
    // Concurrent test com atomic-counter invariant: dois forks para o MESMO destino ⇒ exatamente um
    // wins, the other fails with a typed error. Without an atomic write, both would write over each
    // other and the winner would be the last to close the descriptor — with the file possibly half
    // written.
    const src = escreverTranscript("origem5.jsonl", 20);
    const dst = join(dir, "disputado.jsonl");

    const r = await Promise.allSettled([
      Promise.resolve().then(() => forkTranscript(src, dst, { beforeRecordIndex: 5 })),
      Promise.resolve().then(() => forkTranscript(src, dst, { beforeRecordIndex: 9 })),
    ]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    // And the destination must be INTACT — the record count of one of the two, not a mixture.
    expect([5, 9]).toContain(loadJsonl(dst).length);
  });
});

/**
 * M107 T1.2 — o destino do fork nasce PRIVADO.
 *
 * ## The defect, measured before the change
 *
 * `transcript-ops.ts:84` called `openSync(dst, "wx")` **with no mode argument**, so the file was
 * born `0o666 & ~umask`. Measured on this machine, reproducing that line:
 *
 * ```
 * umask 0o002  ->  destino=0o664      <-- group-WRITABLE
 * umask 0o022  ->  destino=0o644      <-- world-readable
 * umask 0o200  ->  destino=0o466      <-- group E world readable
 * ```
 *
 * A transcript carries the conversation's content. `0o664` is strictly worse than the `0o644` the
 * roadmap claimed — the claim had never been measured. And **no test, anywhere, locked the created
 * file's mode**: that is why the defect was invisible upstream, despite five behaviors of this very
 * fork already being locked.
 *
 * ## Why a DEFAULT and not a knob (D6)
 *
 * A mandatory knob would reach zero consumers by **omission** — the failure mode that
 * `.claude/rules/mecanismo-anti-esquecimento.md § 3` nomeia como a decisiva. O `mode?` existe para
 * whoever needs a different value; the fix does not depend on anyone remembering it.
 *
 * ## Why there is NO mode reassertion here, unlike `atomicWriteJson`
 *
 * Sob `umask 0o200` o destino sai `0o400` em vez de `0o600` — o `umask` limpou o bit de escrita do
 * owner. That is accepted on purpose: the invariant this item buys is *"neither group nor other"*, and
 * `0o400` o satisfaz **com folga**. Reafirmar com `fchmod` devolveria um bit que o operador pediu
 * to remove them, i.e. the SDK would be loosening the `umask` — the wrong direction in a security
 * fix. In `atomicWriteJson` the reassertion exists because there the mode is an EXPLICIT request
 * from the caller; here it is an SDK default.
 *
 * ## What this block deliberately does NOT test
 *
 * `EEXIST` on an existing destination and the typed refusal of a live session **already have an owner** —
 * `test_forkTranscript_RECUSA_sobrescrever_um_destino_existente` e
 * `test_forkTranscript_RECUSA_escrever_sobre_o_ponteiro_vivo`, acima neste arquivo, e ambos rodam no
 * the same command. Repeating them here would be a second oracle over the same fact, which is what
 * `.claude/rules/mecanismo-anti-esquecimento.md` § 5.6 forbids: two oracles diverge.
 *
 * ## Mutation counter-proof (executed; output in the iteration log)
 *
 * | Mutation in `transcript-ops.ts` | Tests that die |
 * |---|---|
 * | `openSync(dst, "wx", options.mode ?? 0o600)` -> `openSync(dst, "wx")` | the three in this block |
 */
describe("M107 T1.2 — o destino do fork nasce privado", () => {
  const dirMode = mkdtempSync(join(tmpdir(), "m107-fork-mode-"));
  afterAll(() => rmSync(dirMode, { recursive: true, force: true }));

  /** Permission bits, without the node type. */
  const mode = (p: string): number => statSync(p).mode & 0o777;

  /** Runs `fn` under a `umask` and restores the previous one — `umask` is PROCESS state. */
  function sobUmask<T>(mask: number, fn: () => T): T {
    const anterior = process.umask(mask);
    try {
      return fn();
    } finally {
      process.umask(anterior);
    }
  }

  function origem(nome: string): string {
    const p = join(dirMode, nome);
    writeFileSync(p, '{"i":0}\n{"i":1}\n');
    return p;
  }

  it("test_o_destino_do_fork_nasce_0600", () => {
    // Arrange — `umask 0o002` is this machine's, and it is what produced `0o664` (group-writable).
    const src = origem("o1.jsonl");
    const dst = join(dirMode, "nasce-0600.jsonl");

    // Act
    sobUmask(0o002, () => forkTranscript(src, dst));

    // Assert
    expect(mode(dst)).toBe(0o600);
  });

  it("test_nenhum_umask_deixa_grupo_ou_outros_enxergarem_o_transcript", () => {
    // Arrange — the item's REAL invariant, across the three measured umasks. Under `0o200` the result is
    // `0o400`: mais restritivo que o pedido, nunca menos (ver o docblock).
    const src = origem("o2.jsonl");

    for (const mask of [0o002, 0o022, 0o200]) {
      const dst = join(dirMode, `mask-${mask.toString(8)}.jsonl`);

      // Act
      sobUmask(mask, () => forkTranscript(src, dst));

      // Assert — zero bits para grupo e para outros, sob qualquer umask.
      expect(mode(dst) & 0o077, `umask 0o${mask.toString(8)} leaked permission`).toBe(0);
      expect(mode(dst) & 0o400).toBe(0o400);
    }
  });

  it("test_mode_explicito_e_honrado", () => {
    // Arrange — the primitive changes the DEFAULT, not the caller's freedom: a mode more permissive
    // than `0o600` is honored, because imposing policy here would be the primitive deciding for the
    // consumer.
    const src = origem("o3.jsonl");
    const dst = join(dirMode, "explicito.jsonl");

    // Act
    sobUmask(0o002, () => forkTranscript(src, dst, { mode: 0o640 }));

    // Assert
    expect(mode(dst)).toBe(0o640);
  });

  it("test_dois_forks_concorrentes_para_o_mesmo_destino_so_um_vence_e_o_vencedor_e_privado", async () => {
    // Arrange — exclusivity (`wx`) and the mode must hold TOGETHER: without this assertion we would
    // prove exclusivity and not privacy.
    const src = origem("o4.jsonl");
    const dst = join(dirMode, "disputado-mode.jsonl");

    // Act
    const r = await sobUmask(0o002, async () =>
      Promise.allSettled([
        Promise.resolve().then(() => forkTranscript(src, dst)),
        Promise.resolve().then(() => forkTranscript(src, dst)),
      ]),
    );

    // Assert (happens-before observation, depois da barreira)
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(mode(dst)).toBe(0o600);
  });
});
