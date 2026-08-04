/**
 * M76 T2.2 — `createGitStatusTool`, ao lado de `createGitDiffTool`.
 *
 * ## Por que no framework
 *
 * O agent-builder tinha isto local (`agents/tools/repo-status.ts` 26 LoC +
 * `agents/tools/lib/repo-status-core.ts` 36 LoC). There is nothing consumer-specific about "running
 * `git status --porcelain` with a timeout and an output ceiling" — it is what any code-editing agent
 * will reimplement, which is the definition of framework infrastructure.
 *
 * ## The pattern is inherited, not invented
 *
 * It follows `git-diff.ts` field by field: `projectRoot` required, `timeoutMs?`, `maxStdoutBytes?`,
 * `sandbox?`. It reuses `runGitProcess`/`formatGitResult`/`checkPathScope` — nothing is rewritten
 * (`parsimony-ladder.md` rung 4: reuse what is already installed).
 *
 * ## The negative case is what matters
 *
 * "Runs in a repo" is satisfied by almost any implementation. What separates a usable tool
 * from a trap is what it does **outside** a repo: `error-handling.md` § 2 requires a typed error with a
 * message, not an empty string (which the model would read as "no changes") nor a raw exception.
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
    // The test that separates a usable tool from a trap: outside a repo, an empty string would be read
    // by the model as "no changes" — which is false and indistinguishable from the happy path.
    const t = createGitStatusTool({ projectRoot: semGit });
    const out = (await t.handler({})) as string;
    const parsed = JSON.parse(out) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error, "the error must be TYPED, not a free-form string").toBe("not_a_repo");
  });

  it("test_o_nome_e_a_descricao_seguem_o_padrao", () => {
    // ANCHOR: the name is a contract (approval key + what the model sees — blueprint Q1). If it
    // mudasse silenciosamente, approvals gravados deixariam de casar.
    const t = createGitStatusTool({ projectRoot: repo });
    expect(t.name).toBe("git_status");
    // M76 review (M3) — `length > 20` was an empty oracle: 21 characters of junk passed. The
    // description is what the model reads to decide to CALL the tool; if it does not say what the tool does,
    // the tool is not chosen, and no behavior test catches that.
    //
    // Note on the first version of this assertion: it required `/git/i` and FAILED — the description speaks of
    // "working-tree status", not of the tool implementing it. The oracle was wrong, not the
    // description: describing the BEHAVIOR (what the model needs in order to choose) rather than the
    // executable is the correct practice, and the test now anchors on that.
    expect(t.description).toMatch(/status/i);
    expect(t.description).toMatch(/staged|untracked|working-tree/i);
  });

  it("test_name_da_fabrica_sobrescreve_como_nas_demais", () => {
    // Parity with T1.2: the new tool is born already respecting the name option.
    const t = createGitStatusTool({ projectRoot: repo, name: "repo_status" });
    expect(t.name).toBe("repo_status");
  });
});

describe("M76 T2.2 — a linha de branch", () => {
  it("test_inclui_branch_por_default", async () => {
    // Without it the agent sees WHAT changed but not WHERE — and "am I on the right branch?" precedes any
    // commit. The consumer already depended on this; migrating without covering it would silently lose behavior.
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
