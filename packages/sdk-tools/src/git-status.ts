/**
 * `git_status` — built-in tool for coding agents.
 *
 * Returns the working-tree status in porcelain v1 format (`git status --porcelain`), which is the
 * stable machine-readable form — the human format is explicitly not guaranteed across git versions.
 *
 * M76 — nasce ao lado de `git_diff` e compartilha o motor de execução (`internal/git-exec.ts`): teto
 * de stdout, kill do grupo de processos no timeout e mapeamento para erro tipado são a MESMA regra
 * para qualquer subcomando do git. O consumidor (agent-builder) tinha isto local em 62 LoC; nada ali
 * era específico dele.
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, diff: string, truncated?: boolean }` — `diff` carrega a saída porcelain
 *   - `{ ok: false, error: 'not_a_repo' | 'path_traversal' | 'timeout' | 'git_failed' }`
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import type { SandboxProvider } from "@theokit/sdk/sandbox";
import { resolveSandbox } from "@theokit/sdk/sandbox";
import { z } from "zod";
import { formatGitResult, runGitProcess, shq } from "./internal/git-exec.js";

import { checkPathScope } from "./path-scope.js";

export interface CreateGitStatusToolOptions {
  /** Absolute path to the project root. Every invocation is gated against this boundary. */
  projectRoot: string;
  /** Wall-clock cap; the process group is killed on expiry. Default 30_000. */
  timeoutMs?: number;
  /** Cap on captured stdout; excess sets `truncated: true`. Default 5 MB. */
  maxStdoutBytes?: number;
  /**
   * Backend de execução injetado (`@theokit/sdk/sandbox`) — quando presente, `git status` roda via
   * `SandboxBackend.execute`; omitido ⇒ o `git` local (inalterado).
   *
   * Simetria com `createGitDiffTool`, apontada pelo review do M76: sem isto `git_diff` rodaria
   * confinado e `git_status` não, na mesma sessão — e a assimetria seria invisível até alguém
   * perceber que uma das duas escapa do sandbox.
   */
  sandbox?: SandboxProvider;
  /**
   * M76 — nome exposto ao modelo. Omitido ⇒ `"git_status"` (aditivo).
   *
   * O nome é contrato: chave de approval, o que o modelo vê e o que o telemetry registra.
   */
  name?: string;
  /** M76 — descrição exposta ao modelo. Omitida ⇒ o literal abaixo (aditivo). */
  description?: string;
  /**
   * Incluir a linha de branch (`-b`) no início da saída. Default `true`.
   *
   * Sem ela o agente vê o que mudou mas não ONDE — e "estou na branch certa?" é a pergunta que
   * precede qualquer commit. O consumidor (agent-builder) já dependia disso; omiti-la faria a
   * migração perder comportamento em silêncio, que é o que a deleção de código local não pode custar.
   */
  includeBranch?: boolean;
}

export function createGitStatusTool(opts: CreateGitStatusToolOptions): CustomTool {
  const { projectRoot, timeoutMs = 30_000, maxStdoutBytes = 5 * 1024 * 1024 } = opts;

  return Tool.create({
    name: opts.name ?? "git_status",
    description:
      opts.description ??
      "Show the working-tree status in porcelain format: staged, unstaged and untracked paths, one " +
        "per line with a two-character status code. Use before committing, or to see what changed " +
        "without reading the full diff. Optional 'path' scopes the report to a subdirectory.",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Optional project-relative path to scope the status report."),
    }),
    handler: async ({ path }, ctx) => {
      // Fora de um repositório, `git status` escreve no stderr e sai não-zero. Devolver string vazia
      // aqui seria pior que um erro: o modelo a leria como "não há mudanças" — indistinguível do
      // caso feliz, e falso. `error-handling.md` § 2 exige erro tipado.
      if (!existsSync(join(projectRoot, ".git"))) {
        return JSON.stringify({ ok: false, error: "not_a_repo" });
      }

      const scopeCheck = checkPathScope(path, projectRoot);
      if (scopeCheck !== null) return scopeCheck;

      const args = montarArgs(path, opts.includeBranch !== false);

      if (opts.sandbox !== undefined) {
        return statusViaSandbox(opts.sandbox, ctx, args, timeoutMs);
      }
      const result = await runGitProcess(projectRoot, args, timeoutMs, maxStdoutBytes);
      return formatGitResult(result, timeoutMs);
    },
  });
}

/**
 * Os argumentos do `git status`.
 *
 * `--porcelain=v1` é deliberado: é o contrato estável para leitura por máquina. O formato humano
 * muda entre versões do git e quebraria o parsing do consumidor sem aviso.
 */
function montarArgs(path: string | undefined, comBranch: boolean): string[] {
  const args = ["status", "--porcelain=v1"];
  if (comBranch) args.push("-b");
  if (path !== undefined && path !== "") args.push("--", path);
  return args;
}

/**
 * `git status` via `SandboxBackend` — o caminho surface-agnostic, espelhando `diffViaSandbox`.
 *
 * Existe por simetria com `git_diff`: sem ele, numa sessão confinada o diff rodaria dentro do
 * sandbox e o status fora — e a assimetria seria invisível até alguém notar que uma das duas escapa.
 */
async function statusViaSandbox(
  sandbox: SandboxProvider,
  ctx: unknown,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const command = ["git", ...args].map(shq).join(" ");
  const backend = await resolveSandbox(sandbox, ctx ?? {});
  const r = await backend.execute(command, { timeoutMs });
  if (r.timedOut) return JSON.stringify({ ok: false, error: "timeout", timeoutMs });
  if (r.exitCode !== 0) {
    return /not a git repository/i.test(r.stderr)
      ? JSON.stringify({ ok: false, error: "not_a_repo" })
      : JSON.stringify({ ok: false, error: "git_failed", stderr: r.stderr });
  }
  return JSON.stringify({ ok: true, diff: r.stdout, truncated: false });
}
