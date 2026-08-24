/**
 * `git_status` — built-in tool for coding agents.
 *
 * Returns the working-tree status in porcelain v1 format (`git status --porcelain`), which is the
 * stable machine-readable form — the human format is explicitly not guaranteed across git versions.
 *
 * M76 — born alongside `git_diff` and sharing the execution engine (`internal/git-exec.ts`): the stdout
 * ceiling, process-group kill on timeout and mapping to a typed error are the SAME rule
 * for any git subcommand. The consumer (agent-builder) had this locally in 62 LoC; nothing there
 * was specific to it.
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, diff: string, truncated?: boolean }` — `diff` carries the porcelain output
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
   * Injected execution backend (`@theokit/sdk/sandbox`) — when present, `git status` runs via
   * `SandboxBackend.execute`; omitted ⇒ the local `git` (unchanged).
   *
   * Symmetry with `createGitDiffTool`, flagged by the M76 review: without it `git_diff` would run
   * confined and `git_status` not, in the same session — and the asymmetry would be invisible until
   * someone noticed that one of the two escapes the sandbox.
   *
   * When set, the repository question is answered by the BACKEND (from git's own stderr), not by a
   * probe of the host's filesystem. #346 — the host probe used to run first, so a session whose
   * checkout lives inside the backend got `not_a_repo` for a repository that was there.
   */
  sandbox?: SandboxProvider;
  /**
   * M76 — the name exposed to the model. Omitted ⇒ `"git_status"` (additive).
   *
   * The name is a contract: the approval key, what the model sees and what telemetry records.
   */
  name?: string;
  /** M76 — description exposed to the model. Omitted => the literal below (additive). */
  description?: string;
  /**
   * Include the branch line (`-b`) at the start of the output. Default `true`.
   *
   * Without it the agent sees what changed but not WHERE — and "am I on the right branch?" is the question that
   * precedes any commit. The consumer (agent-builder) already depended on it; omitting it would make the
   * migration lose behavior silently, which is what deleting local code must not cost.
   */
  includeBranch?: boolean;
}

/**
 * Build the `git_status` tool. Returns `git status --porcelain=v1` output, which is the reason to use
 * this rather than a `shell_exec` of plain `git status`: the human format is not stable across git
 * versions and the porcelain one is.
 *
 * The output arrives in a field named `diff`, shared with {@link createGitDiffTool} rather than named
 * after what it holds.
 *
 * A missing `.git` is `{ ok: false, error: "not_a_repo" }` rather than an empty string, so the model
 * cannot read "not a repository" as "nothing changed". The other refusals are `path_traversal`,
 * `timeout` and `git_failed`.
 *
 * With `sandbox` the command itself runs through the injected backend — but the local `.git` probe
 * runs BEFORE that branch, so a sandboxed status still requires `<projectRoot>/.git` to exist on the
 * host. {@link createGitDiffTool} skips its equivalent probe when sandboxed. Configure both tools the
 * same way in one session: one confined and one not is an asymmetry nothing surfaces.
 */
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
      // Security first, and independent of where the command runs (#346 — the host probe used to
      // precede it, so a traversal attempt in a confined session was answered `not_a_repo`).
      const scopeCheck = checkPathScope(path, projectRoot);
      if (scopeCheck !== null) return scopeCheck;

      const args = buildArgs(path, opts.includeBranch !== false);

      if (opts.sandbox !== undefined) {
        // #346 — the repository question is answered WHERE THE COMMAND RUNS, exactly as
        // `diffViaSandbox` answers it. The host probe below would refuse a session whose checkout
        // lives inside the backend, and refuse it with the one error that must never be wrong:
        // `not_a_repo` exists so the model cannot read "no repository" as "nothing changed", and
        // saying it about a repository with changes is worse than being unavailable.
        return statusViaSandbox(opts.sandbox, ctx, args, timeoutMs);
      }

      // Local path only. Outside a repository, `git status` writes to stderr and exits non-zero;
      // returning an empty string would be worse than an error, since the model would read it as
      // "no changes" — indistinguishable from the happy path, and false (`error-handling.md` § 2).
      if (!existsSync(join(projectRoot, ".git"))) {
        return JSON.stringify({ ok: false, error: "not_a_repo" });
      }
      const result = await runGitProcess(projectRoot, args, timeoutMs, maxStdoutBytes);
      return formatGitResult(result, timeoutMs);
    },
  });
}

/**
 * The arguments to `git status`.
 *
 * `--porcelain=v1` is deliberate: it is the stable contract for machine reading. The human format
 * changes across git versions and would break the consumer's parsing without warning.
 */
function buildArgs(path: string | undefined, withBranch: boolean): string[] {
  const args = ["status", "--porcelain=v1"];
  if (withBranch) args.push("-b");
  if (path !== undefined && path !== "") args.push("--", path);
  return args;
}

/**
 * `git status` via `SandboxBackend` — the surface-agnostic path, mirroring `diffViaSandbox`.
 *
 * It exists for symmetry with `git_diff`: without it, in a confined session the diff would run inside the
 * sandbox and the status outside — and the asymmetry would be invisible until someone noticed one of the two escapes.
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
