/**
 * `git_diff` — built-in tool for coding agents.
 *
 * Returns the unified diff of the working tree (or staged changes when
 * `cached=true`). Implemented as a thin `git diff` subprocess wrapper
 * with a couple of hard limits:
 *
 *   - 30s wall clock timeout (kills the process group on expiry)
 *   - 5 MB stdout cap (truncate + flag `truncated=true`)
 *   - Path scope validated through `safePathJoin` + `assertNoSymlinkEscape`
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, diff: string, truncated?: boolean }`
 *   - `{ ok: false, error: 'not_a_repo' | 'path_traversal' | 'timeout' }`
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import { resolveSandbox, type SandboxProvider } from "@theokit/sdk/sandbox";
import { z } from "zod";
import { formatGitResult, runGitProcess, shq } from "./internal/git-exec.js";
import { checkPathScope } from "./path-scope.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDOUT_BYTES = 5 * 1024 * 1024;

export interface CreateGitDiffToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** Absolute path to the project root. `git` runs here and every `path` scope is gated against it. */
  projectRoot: string;
  /** Wall-clock cap on the local `git` child; the process group is killed on expiry. Default 30_000. */
  timeoutMs?: number;
  /** Cap on captured stdout; excess sets `truncated: true`. Default 5 MB. Local path only. */
  maxStdoutBytes?: number;
  /** Optional injected execution backend (`@theokit/sdk/sandbox`) — when provided, `git diff` runs via
   *  `SandboxBackend.execute` (surface-agnostic); omitted ⇒ the local `git` child process (unchanged). */
  sandbox?: SandboxProvider;
}

/** Run `git diff` through an injected SandboxBackend, mapping its result to git_diff's JSON shape. The
 *  scope check (pure security) still applies; the local `.git` existsSync check does not (the repo is in
 *  the backend — a non-repo surfaces as git's own "not a git repository"). */
async function diffViaSandbox(
  sandbox: SandboxProvider,
  ctx: unknown,
  cached: boolean | undefined,
  path: string | undefined,
  projectRoot: string,
  timeoutMs: number,
): Promise<string> {
  const scopeCheck = checkPathScope(path, projectRoot);
  if (scopeCheck !== null) return scopeCheck;
  const command = ["git", ...buildDiffArgs(cached, path)].map(shq).join(" ");
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

/**
 * Build the `git_diff` tool: `git diff --no-color` over the working tree, or the staged changes when
 * the model passes `cached`.
 *
 * Reach for it before a commit or after a run of edits, when the question is what CHANGED rather than
 * what a file now contains — `read_file` answers the latter and spends a whole file doing it.
 *
 * Refusals are `not_a_repo`, `path_traversal`, `timeout` and `git_failed`. The local path kills the
 * process group at `timeoutMs` and caps captured stdout at `maxStdoutBytes`, flagging
 * `truncated: true`; neither limit applies on the `sandbox` path, where the backend's own `timeoutMs`
 * is the only bound and `truncated` always comes back false.
 *
 * With `sandbox` set the local `.git` probe is skipped deliberately — the repository lives in the
 * backend, and a missing one surfaces as git's own "not a git repository".
 */
export function createGitDiffTool(opts: CreateGitDiffToolOptions): CustomTool {
  const {
    projectRoot,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    sandbox,
  } = opts;

  return Tool.create({
    name: opts.name ?? "git_diff",
    description:
      opts.description ??
      "Return the unified diff of the project's working tree (or staged " +
        "changes when cached=true). Scoped to a single file when 'path' is " +
        "provided. Requires the project to be a git repository. Returns " +
        "{ ok, diff, truncated? } or { ok: false, error }.",
    inputSchema: z.object({
      path: z.string().optional().describe("Optional project-relative file or dir scope."),
      cached: z
        .boolean()
        .optional()
        .describe("If true, show staged changes (git diff --cached). Default false."),
    }),
    handler: async ({ path, cached }, ctx) => {
      // Injected backend (surface-agnostic) ⇒ run in the sandbox; absent ⇒ the local `git` (unchanged).
      if (sandbox !== undefined) {
        return diffViaSandbox(sandbox, ctx, cached, path, projectRoot, timeoutMs);
      }

      // Local path — UNCHANGED (byte-identical to before).
      if (!existsSync(join(projectRoot, ".git"))) {
        return JSON.stringify({ ok: false, error: "not_a_repo" });
      }

      const scopeCheck = checkPathScope(path, projectRoot);
      if (scopeCheck !== null) return scopeCheck;

      const args = buildDiffArgs(cached, path);
      const result = await runGitProcess(projectRoot, args, timeoutMs, maxStdoutBytes);
      return formatGitResult(result, timeoutMs);
    },
  });
}

function buildDiffArgs(cached: boolean | undefined, path: string | undefined): string[] {
  const args = ["diff", "--no-color"];
  if (cached === true) args.push("--cached");
  if (path !== undefined && path !== "") args.push("--", path);
  return args;
}
