/**
 * Git CLI wrapper via `execFile` — safe subprocess invocation.
 *
 * Every function returns a discriminated union: `{ok: true, ...}` or `{ok: false, error: string}`.
 */

import { execFile } from "node:child_process";

function run(
  args: string[],
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: stderr.trim() || err.message });
      } else {
        resolve({ ok: true, stdout: stdout.trim() });
      }
    });
  });
}

export async function gitStatus(
  cwd: string,
): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  const result = await run(["status", "--porcelain"], cwd);
  if (!result.ok) return result;
  const files = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { ok: true, files };
}

export async function gitDiff(
  cwd: string,
  path?: string,
): Promise<{ ok: true; diff: string } | { ok: false; error: string }> {
  const args = ["diff"];
  if (path) args.push("--", path);
  const result = await run(args, cwd);
  if (!result.ok) return result;
  return { ok: true, diff: result.stdout };
}

export async function gitLog(
  cwd: string,
  limit = 10,
): Promise<
  | { ok: true; commits: Array<{ hash: string; message: string; date: string }> }
  | { ok: false; error: string }
> {
  const result = await run(["log", `--max-count=${limit}`, "--format=%H||%s||%aI"], cwd);
  if (!result.ok) return result;
  const commits = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash = "", message = "", date = ""] = line.split("||");
      return { hash, message, date };
    });
  return { ok: true, commits };
}
