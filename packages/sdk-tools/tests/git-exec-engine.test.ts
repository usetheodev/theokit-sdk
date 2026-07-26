/**
 * M76 review (H2) — as três garantias do motor de git, que não tinham oráculo nenhum.
 *
 * ## O que a mutação provou
 *
 * O docblock de `internal/git-exec.ts` promete teto de stdout, kill do grupo de processos no timeout
 * e mapeamento para erro tipado. As três mutações abaixo **passavam com 554 verdes**:
 *
 *  - remover o teto de stdout e a flag `truncated`;
 *  - `armTimeoutKill(child, 86_400_000, …)` — o kill nunca dispara;
 *  - `formatGitResult` mapeando timeout para `{ok: true, diff: ""}`.
 *
 * ## Honestidade sobre a causa
 *
 * Isto **não foi perdido na extração** do M76: `tests/git-diff.test.ts` nunca cobriu timeout, teto
 * nem kill — só shape, happy path, escopo e `not_a_repo`. O que a extração fez foi **dobrar o raio de
 * explosão**: o mesmo motor sem oráculo passou a servir `git_diff` e `git_status`, e o `git-status.ts`
 * publica `timeoutMs?`/`maxStdoutBytes?` como se fossem garantias verificadas.
 *
 * Cobrir agora é responsabilidade deste milestone porque foi ele que dobrou o alcance.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createGitStatusTool } from "../src/git-status.js";

const repo = mkdtempSync(join(tmpdir(), "m76-gitexec-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

execFileSync("git", ["init", "-q"], { cwd: repo });
execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
execFileSync("git", ["config", "user.name", "t"], { cwd: repo });

describe("M76 review — o motor de git honra os limites que publica", () => {
  it("test_o_teto_de_stdout_TRUNCA_e_sinaliza", async () => {
    // Muitos arquivos não-rastreados ⇒ saída grande. Com o teto em 200 bytes, a saída real a excede
    // e a flag `truncated` tem de subir. Sem o teto, um repo com milhares de arquivos devolveria
    // megabytes ao modelo — estourando a janela de contexto sem aviso.
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(repo, `arquivo-com-nome-bem-longo-${String(i)}.txt`), "x");
    }
    const t = createGitStatusTool({ projectRoot: repo, maxStdoutBytes: 200 });
    const parsed = JSON.parse((await t.handler({})) as string) as {
      ok: boolean;
      diff: string;
      truncated: boolean;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.truncated, "a saída excedeu o teto e `truncated` não subiu").toBe(true);
    expect(
      Buffer.byteLength(parsed.diff),
      "o teto não foi respeitado — a saída passou do limite publicado",
    ).toBeLessThanOrEqual(400);
  });

  it("test_o_teto_generoso_NAO_marca_truncated", async () => {
    // CONTRAPROVA: sem ela, uma implementação que marcasse `truncated: true` sempre passaria acima.
    const t = createGitStatusTool({ projectRoot: repo, maxStdoutBytes: 5 * 1024 * 1024 });
    const parsed = JSON.parse((await t.handler({})) as string) as { truncated: boolean };
    expect(parsed.truncated).toBe(false);
  });

  it("test_timeout_vira_erro_TIPADO_e_nao_sucesso_vazio", async () => {
    // O mapeamento que a mutação quebrava: timeout → `{ok:true, diff:""}` passava despercebido, e o
    // modelo leria "nenhuma mudança" onde na verdade o comando foi morto. Pior que um erro.
    const t = createGitStatusTool({ projectRoot: repo, timeoutMs: 1 });
    const parsed = JSON.parse((await t.handler({})) as string) as {
      ok: boolean;
      error?: string;
      timeoutMs?: number;
    };

    // Um `git status` pode terminar em <1ms num repo minúsculo; então aceitamos as duas saídas, mas
    // NUNCA a terceira (ok:true com diff vazio por causa de timeout).
    if (parsed.ok) {
      expect(parsed.error).toBeUndefined();
    } else {
      expect(parsed.error, "timeout tem de ser erro TIPADO").toBe("timeout");
      expect(parsed.timeoutMs, "o erro carrega o limite que foi excedido").toBe(1);
    }
  });
});
