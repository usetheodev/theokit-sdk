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
 * any absolute path.
 *
 * ## The test that matters most is the negative one
 *
 * The happy case (`allowAbsolute: true` lists outside the root) proves little — almost any wrong
 * implementation satisfies it. What separates a correct implementation from a dangerous one is `.env` in a
 * in the **middle** of the path, which `isForbiddenPath` alone lets through.
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
// `call(".")` returns an empty listing on both sides and the `toBe` compares empty with empty — it would pass
// even if the flag broke the relative path entirely.
writeFileSync(join(raiz, "dentro-da-raiz.txt"), "x");
// `.env` in a MIDDLE segment — the case `isForbiddenPath` alone does not catch.
const comSegredoNoMeio = join(fora, ".env", "sub");
mkdirSync(comSegredoNoMeio, { recursive: true });
writeFileSync(join(comSegredoNoMeio, "vazado.txt"), "SEGREDO");

const call = async (path: string, allowAbsolute?: boolean): Promise<string> => {
  const t = createListDirTool(
    allowAbsolute === undefined ? { projectRoot: raiz } : { projectRoot: raiz, allowAbsolute },
  );
  return (await t.handler({ path })) as string;
};

describe("M76 T2.1 — allowAbsolute em list_dir", () => {
  it("test_default_false_rejeita_absoluto", async () => {
    // Backward compatibility: callers not asking for the flag see no behavior change.
    const out = await call(fora);
    expect(out).toMatch(/forbidden|outside|error/i);
    expect(out).not.toContain("visivel.txt");
  });

  it("test_allow_absolute_permite_fora_do_root", async () => {
    const out = await call(fora, true);
    expect(out).toContain("visivel.txt");
  });

  it("test_NEGATIVO_guard_bloqueia_segredo_em_QUALQUER_segmento", async () => {
    // The test that justifies D3. Without the per-segment guard, this path lists — and the `.env` in the middle
    // becomes just another directory, which is exactly the exfiltration hole `read-file` closed.
    const out = await call(comSegredoNoMeio, true);
    expect(out, "a `.env` in an intermediate segment MUST block").toMatch(/forbidden/i);
    expect(out).not.toContain("vazado.txt");
  });

  it("test_relative_does_not_change_with_the_flag_on", async () => {
    // COUNTER-PROOF that the flag only decides about ABSOLUTE paths: the relative case is identical with
    // ele ligado ou desligado. Sem esta, um bug que liberasse tudo passaria nos testes acima.
    const withFlag = await call(".", true);
    const semFlag = await call(".");

    // M76 review (M6) — the ANCHOR comes before the comparison. The previous version only did the `toBe`, and the
    // root was an empty tmpdir: it compared empty-listing with empty-listing. An implementation that
    // returned "" for every relative path passed. Proving the two sides are EQUAL is only worth something
    // after proving both sides have CONTENT.
    expect(withFlag, "the relative listing must contain the root file").toContain(
      "dentro-da-raiz.txt",
    );
    expect(semFlag).toContain("dentro-da-raiz.txt");
    expect(withFlag).toBe(semFlag);
  });
});
