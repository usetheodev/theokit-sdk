/**
 * M76 T2.1 — `allowAbsolute` em `list_dir`, com o guard de segredo na MESMA entrega.
 *
 * ## Por que as duas coisas juntas
 *
 * `read-file.ts` documenta por que o flag sozinho é perigoso:
 *
 * > *"`isForbiddenPath` only blocks the sensitive item when it is the FIRST (project-relative)
 * > segment; an absolute path (`/home/u/proj/.env`) puts it deeper, so this checks EVERY segment.
 * > **Closes the reads-anywhere exfiltration hole** (`.env`/`.git`/… at any depth)."*
 *
 * Ou seja: ligar `allowAbsolute` sem o guard por segmento não é "uma feature sem uma proteção" — é
 * abrir exfiltração. `rules/parsimony-ladder.md § Never on the chopping block` diz que segurança não
 * é o que se corta para simplificar, e entregar em duas etapas cria uma janela em que a tool lê
 * qualquer caminho absoluto.
 *
 * ## O teste que mais importa é o negativo
 *
 * O caso feliz (`allowAbsolute: true` lista fora do root) prova pouco — quase qualquer implementação
 * errada o satisfaz. O que separa uma implementação correta de uma perigosa é o `.env` num segmento
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
// `.env` num segmento do MEIO — o caso que `isForbiddenPath` sozinho não pega.
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
    // Retrocompatibilidade: quem não pede o flag não muda de comportamento.
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
    // vira um diretório qualquer, que é exatamente o buraco de exfiltração que `read-file` fechou.
    const out = await chamar(comSegredoNoMeio, true);
    expect(out, "um `.env` em segmento intermediário TEM de bloquear").toMatch(/forbidden/i);
    expect(out).not.toContain("vazado.txt");
  });

  it("test_relativo_nao_muda_com_o_flag_ligado", async () => {
    // CONTRAPROVA de que o flag só decide sobre caminhos ABSOLUTOS: o caso relativo é idêntico com
    // ele ligado ou desligado. Sem esta, um bug que liberasse tudo passaria nos testes acima.
    const comFlag = await chamar(".", true);
    const semFlag = await chamar(".");
    expect(comFlag).toBe(semFlag);
  });
});
