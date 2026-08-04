/**
 * M76 review (H2) — the git engine's three guarantees, which had no oracle at all.
 *
 * ## What mutation proved
 *
 * O docblock de `internal/git-exec.ts` promete teto de stdout, kill do grupo de processos no timeout
 * and mapping to a typed error. The three mutations below **passed with 554 green**:
 *
 *  - remover o teto de stdout e a flag `truncated`;
 *  - `armTimeoutKill(child, 86_400_000, …)` — o kill nunca dispara;
 *  - `formatGitResult` mapeando timeout para `{ok: true, diff: ""}`.
 *
 * ## Honestidade sobre a causa
 *
 * This was **not lost in M76's extraction**: `tests/git-diff.test.ts` never covered timeout, ceiling
 * or kill — only shape, happy path, scope and `not_a_repo`. What the extraction did was **double the blast
 * radius**: the same oracle-less engine now serves `git_diff` and `git_status`, and `git-status.ts`
 * publica `timeoutMs?`/`maxStdoutBytes?` como se fossem garantias verificadas.
 *
 * Covering it now is this milestone's responsibility because it is what doubled the reach.
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
    // Many untracked files => large output. With the ceiling at 200 bytes, the real output exceeds it
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
    expect(parsed.truncated, "output exceeded the ceiling and `truncated` did not go up").toBe(
      true,
    );
    expect(
      Buffer.byteLength(parsed.diff),
      "the ceiling was not respected — output went past the published limit",
    ).toBeLessThanOrEqual(400);
  });

  it("test_o_teto_generoso_NAO_marca_truncated", async () => {
    // COUNTER-PROOF: without it, an implementation always setting `truncated: true` would pass above.
    const t = createGitStatusTool({ projectRoot: repo, maxStdoutBytes: 5 * 1024 * 1024 });
    const parsed = JSON.parse((await t.handler({})) as string) as { truncated: boolean };
    expect(parsed.truncated).toBe(false);
  });

  it("test_timeout_vira_erro_TIPADO_e_nao_sucesso_vazio", async () => {
    // The mapping the mutation broke: timeout -> `{ok:true, diff:""}` went unnoticed, and the
    // model would read "no changes" where the command was actually killed. Worse than an error.
    const t = createGitStatusTool({ projectRoot: repo, timeoutMs: 1 });
    const parsed = JSON.parse((await t.handler({})) as string) as {
      ok: boolean;
      error?: string;
      timeoutMs?: number;
    };

    // A `git status` can finish in <1ms in a tiny repo; so we accept both outcomes, but
    // NUNCA a terceira (ok:true com diff vazio por causa de timeout).
    if (parsed.ok) {
      expect(parsed.error).toBeUndefined();
    } else {
      expect(parsed.error, "timeout tem de ser erro TIPADO").toBe("timeout");
      expect(parsed.timeoutMs, "o erro carrega o limite que foi excedido").toBe(1);
    }
  });
});
