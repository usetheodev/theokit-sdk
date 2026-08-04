/**
 * M76 T2.1 — `allowAbsolute` em `list_dir`, com o guard de segredo na MESMA entrega.
 *
 * ## Por que as duas coisas juntas
 *
 * `read-file.ts` documents why the flag alone is dangerous:
 *
 * > *"`isForbiddenPath` only blocks the sensitive item when it is the FIRST (project-relative)
 * > segment; an absolute path (`/home/u/proj/.env`) puts it deeper, so this checks EVERY segment.
 * > **Closes the reads-anywhere exfiltration hole** (`.env`/`.git`/… at any depth)."*
 *
 * That is: enabling `allowAbsolute` without the per-segment guard is not "a feature missing a guard" — it is
 * opening exfiltration. `rules/parsimony-ladder.md` § Never on the chopping block says security is not
 * what gets cut to simplify, and shipping in two stages creates a window where the tool reads
 * qualquer caminho absoluto.
 *
 * ## The test that matters most is the negative one
 *
 * The happy case (`allowAbsolute: true` lists outside the root) proves little — almost any wrong
 * implementation satisfies it. What separates a correct implementation from a dangerous one is `.env` in a
 * **do meio** do caminho, que `isForbiddenPath` sozinho deixa passar.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createListDirTool } from "../src/list-dir.js";

const raiz = mkdtempSync(join(tmpdir(), "m76-listdir-"));
const fora = mkdtempSync(join(tmpdir(), "m76-fora-"));
afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
  rmSync(fora, { recursive: true, force: true });
});

writeFileSync(join(fora, "visivel.txt"), "x");
// Non-vacuity anchor for the relative counter-proof (M76 review / M6): without a file INSIDE the root,
// `chamar(".")` devolve listagem vazia nos dois lados e o `toBe` compara vazio com vazio — passaria
// mesmo se o flag quebrasse o caminho relativo por completo.
writeFileSync(join(raiz, "dentro-da-raiz.txt"), "x");
// `.env` in a MIDDLE segment — the case `isForbiddenPath` alone does not catch.
const comSegredoNoMeio = join(fora, ".env", "sub");
mkdirSync(comSegredoNoMeio, { recursive: true });
writeFileSync(join(comSegredoNoMeio, "vazado.txt"), "SEGREDO");

const chamar = async (path: string, allowAbsolute?: boolean): Promise<string> => {
  const t = createListDirTool(
    allowAbsolute === undefined ? { projectRoot: raiz } : { projectRoot: raiz, allowAbsolute },
  );
  return (await t.handler({ path })) as string;
};

describe("M76 T2.1 — allowAbsolute em list_dir", () => {
  it("test_default_false_rejeita_absoluto", async () => {
    // Backward compatibility: callers not asking for the flag see no behavior change.
    const out = await chamar(fora);
    expect(out).toMatch(/forbidden|outside|error/i);
    expect(out).not.toContain("visivel.txt");
  });

  it("test_allow_absolute_permite_fora_do_root", async () => {
    const out = await chamar(fora, true);
    expect(out).toContain("visivel.txt");
  });

  it("test_NEGATIVO_guard_bloqueia_segredo_em_QUALQUER_segmento", async () => {
    // O teste que justifica D3. Sem o guard por segmento, este caminho lista — e o `.env` no meio
    // becomes just another directory, which is exactly the exfiltration hole `read-file` closed.
    const out = await chamar(comSegredoNoMeio, true);
    expect(out, "a `.env` in an intermediate segment MUST block").toMatch(/forbidden/i);
    expect(out).not.toContain("vazado.txt");
  });

  it("test_relativo_nao_muda_com_o_flag_ligado", async () => {
    // COUNTER-PROOF that the flag only decides about ABSOLUTE paths: the relative case is identical with
    // ele ligado ou desligado. Sem esta, um bug que liberasse tudo passaria nos testes acima.
    const comFlag = await chamar(".", true);
    const semFlag = await chamar(".");

    // M76 review (M6) — the ANCHOR comes before the comparison. The previous version only did the `toBe`, and the
    // root was an empty tmpdir: it compared empty-listing with empty-listing. An implementation that
    // returned "" for every relative path passed. Proving the two sides are EQUAL is only worth something
    // after proving both sides have CONTENT.
    expect(comFlag, "a listagem relativa tem de conter o arquivo da raiz").toContain(
      "dentro-da-raiz.txt",
    );
    expect(semFlag).toContain("dentro-da-raiz.txt");
    expect(comFlag).toBe(semFlag);
  });
});
