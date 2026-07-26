/**
 * M76 T2.2 — `createGitStatusTool`, ao lado de `createGitDiffTool`.
 *
 * ## Por que no framework
 *
 * O agent-builder tinha isto local (`agents/tools/repo-status.ts` 26 LoC +
 * `agents/tools/lib/repo-status-core.ts` 36 LoC). Não há nada de específico do consumidor em "rodar
 * `git status --porcelain` com timeout e teto de saída" — é o que qualquer agente que edite código
 * vai reimplementar, que é a definição de infraestrutura de framework.
 *
 * ## O padrão é herdado, não inventado
 *
 * Segue `git-diff.ts` campo a campo: `projectRoot` obrigatório, `timeoutMs?`, `maxStdoutBytes?`,
 * `sandbox?`. Reusa `runGitProcess`/`formatGitResult`/`checkPathScope` — nada é reescrito
 * (`parsimony-ladder.md` rung 4: reusar o que já está instalado).
 *
 * ## O caso negativo é o que importa
 *
 * "Roda em um repo" é satisfeito por quase qualquer implementação. O que separa uma tool utilizável
 * de uma armadilha é o que ela faz **fora** de um repo: `error-handling.md` § 2 exige erro tipado com
 * mensagem, não string vazia (que o modelo leria como "não há mudanças") nem exceção crua.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createGitStatusTool } from "../src/git-status.js";

const repo = mkdtempSync(join(tmpdir(), "m76-gitstatus-"));
const semGit = mkdtempSync(join(tmpdir(), "m76-nogit-"));
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(semGit, { recursive: true, force: true });
});

execFileSync("git", ["init", "-q"], { cwd: repo });
execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
writeFileSync(join(repo, "rastreado.txt"), "a\n");
execFileSync("git", ["add", "."], { cwd: repo });
execFileSync("git", ["commit", "-qm", "inicial"], { cwd: repo });

describe("M76 T2.2 — createGitStatusTool", () => {
  it("test_git_status_reporta_arquivo_modificado", async () => {
    writeFileSync(join(repo, "rastreado.txt"), "a\nb\n");
    const t = createGitStatusTool({ projectRoot: repo });
    const out = (await t.handler({})) as string;
    expect(out).toContain("rastreado.txt");
  });

  it("test_git_status_reporta_arquivo_novo", async () => {
    writeFileSync(join(repo, "novo.txt"), "x");
    const t = createGitStatusTool({ projectRoot: repo });
    const out = (await t.handler({})) as string;
    expect(out).toContain("novo.txt");
  });

  it("test_NEGATIVO_fora_de_repo_git_devolve_erro_tipado", async () => {
    // O teste que separa tool utilizável de armadilha: fora de um repo, uma string vazia seria lida
    // pelo modelo como "não há mudanças" — que é falso e indistinguível do caso feliz.
    const t = createGitStatusTool({ projectRoot: semGit });
    const out = (await t.handler({})) as string;
    const parsed = JSON.parse(out) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error, "o erro precisa ser TIPADO, não uma string livre").toBe("not_a_repo");
  });

  it("test_o_nome_e_a_descricao_seguem_o_padrao", () => {
    // ÂNCORA: o nome é contrato (chave de approval + o que o modelo vê — blueprint Q1). Se ele
    // mudasse silenciosamente, approvals gravados deixariam de casar.
    const t = createGitStatusTool({ projectRoot: repo });
    expect(t.name).toBe("git_status");
    // M76 review (M3) — `length > 20` era um oráculo vazio: 21 caracteres de lixo passavam. A
    // descrição é o que o modelo lê para decidir CHAMAR a tool; se ela não disser o que a tool faz,
    // a tool não é escolhida, e nenhum teste de comportamento pega isso.
    //
    // Nota sobre a primeira versão desta asserção: ela exigia `/git/i` e FALHOU — a descrição fala de
    // "working-tree status", não da ferramenta que a implementa. O oráculo estava errado, não a
    // descrição: descrever o COMPORTAMENTO (o que o modelo precisa para escolher) em vez do
    // executável é a prática correta, e o teste agora ancora nisso.
    expect(t.description).toMatch(/status/i);
    expect(t.description).toMatch(/staged|untracked|working-tree/i);
  });

  it("test_name_da_fabrica_sobrescreve_como_nas_demais", () => {
    // Paridade com T1.2: a tool nova nasce já respeitando a opção de nome.
    const t = createGitStatusTool({ projectRoot: repo, name: "repo_status" });
    expect(t.name).toBe("repo_status");
  });
});

describe("M76 T2.2 — a linha de branch", () => {
  it("test_inclui_branch_por_default", async () => {
    // Sem ela o agente vê O QUE mudou mas não ONDE — e "estou na branch certa?" precede qualquer
    // commit. O consumidor já dependia disto; migrar sem cobrir perderia comportamento em silêncio.
    const t = createGitStatusTool({ projectRoot: repo });
    const out = (await t.handler({})) as string;
    expect(out).toMatch(/##/); // porcelain -b marca a branch com '## '
  });

  it("test_pode_ser_desligada", async () => {
    const t = createGitStatusTool({ projectRoot: repo, includeBranch: false });
    const out = (await t.handler({})) as string;
    const parsed = JSON.parse(out) as { diff: string };
    expect(
      parsed.diff
        .split("\n")
        .filter(Boolean)
        .every((l) => !l.startsWith("##")),
    ).toBe(true);
  });
});
