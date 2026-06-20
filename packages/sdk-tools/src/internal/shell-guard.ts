/**
 * Catastrophic-command guardrail for `shell_exec` (M3-2).
 *
 * `catastrophicShellReason` is a pure, segment-aware deny-list: it splits a
 * command on top-level connectors (`;`, `&&`, `||`, pipe), strips `sudo`/`env`
 * prefixes, and matches at COMMAND POSITION (the executable, not an arbitrary
 * substring) so a mention like `echo "rm -rf /"` is not over-blocked. It returns
 * a human reason for the first catastrophic segment, else `null`.
 *
 * This is a heuristic GUARDRAIL, NOT a sandbox: it is bypassable by obfuscation
 * (eval/base64) and is best-effort. POSIX `/bin/sh` only; Windows PowerShell is
 * out of scope. Design: blueprint m3-catastrophic-shell. Zero new deps.
 */

import { ConfigurationError } from "@theokit/sdk";

/** Thrown / reported when a command matches the catastrophic deny-list. */
export class CatastrophicCommandError extends ConfigurationError {
  override readonly name = "CatastrophicCommandError";
  constructor(reason: string) {
    super(`Refused a catastrophic shell command: ${reason} (shell guardrail).`, {
      code: "catastrophic_command",
    });
  }
}

const SHELL_NAMES = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);
const PREFIX_TOKENS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "time",
  "nice",
  "nohup",
  "exec",
  "builtin",
]);

/** Self-named function piping into itself: the classic `:(){ :|:& };:`. */
const FORK_BOMB = /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}/;
/** `> /dev/sda` and friends (NOT /dev/null — that is benign). */
const DEVICE_REDIRECT = /[>]\s*\/dev\/(?:sd|nvme|hd|vd|mmcblk|disk)\b/;

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function unquote(t: string): string {
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return t.slice(1, -1);
  }
  return t;
}

function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/** Split on top-level connectors. Order matters: `&&`/`||` before single `|`. */
function splitSegments(cmd: string): string[] {
  return cmd.split(/&&|\|\||;|\|/);
}

function stripPrefixTokens(tokens: string[]): string[] {
  let t = tokens;
  let head = t[0];
  while (head !== undefined && PREFIX_TOKENS.has(basename(unquote(head)))) {
    t = t.slice(1);
    head = t[0];
  }
  return t;
}

function operandsOf(tokens: string[]): string[] {
  return tokens
    .slice(1)
    .filter((t) => !t.startsWith("-"))
    .map(unquote);
}

/** Matches the shell HOME variable in `$HOME` or `${HOME}` form. */
const HOME_VAR = /^\$\{?HOME\}?$/;

/** Root / home / glob targets that make a recursive delete catastrophic. */
function isRootishPath(op: string): boolean {
  if (op === "~" || op === "*" || op === "." || HOME_VAR.test(op)) return true;
  const collapsed = op.replace(/\/+/g, "/");
  return collapsed === "/" || collapsed === "/*" || collapsed === "/.";
}

function hasRecursiveForce(tokens: string[]): boolean {
  const flags = tokens.slice(1).filter((t) => t.startsWith("-"));
  const recursive = flags.some(
    (f) => f === "--recursive" || (!f.startsWith("--") && /[rR]/.test(f)),
  );
  const force = flags.some((f) => f === "--force" || (!f.startsWith("--") && f.includes("f")));
  return recursive && force;
}

function hasRecursiveFlag(tokens: string[]): boolean {
  return tokens
    .slice(1)
    .some(
      (t) => t === "--recursive" || (t.startsWith("-") && !t.startsWith("--") && /[rR]/.test(t)),
    );
}

/** `curl`/`wget` output piped into `sh`/`bash`/... anywhere in the command. */
function isCurlPipedToShell(cmd: string): boolean {
  const segs = cmd
    .replace(/\|\|/g, ";")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  let fetcher = false;
  let shell = false;
  for (const s of segs) {
    const tk = stripPrefixTokens(tokenize(s));
    const head = tk[0];
    if (head === undefined) continue;
    const c = basename(unquote(head));
    if (c === "curl" || c === "wget") fetcher = true;
    if (SHELL_NAMES.has(c)) shell = true;
  }
  return fetcher && shell;
}

type SegmentCheck = (cmd0: string, tokens: string[], seg: string) => string | null;

const rmCheck: SegmentCheck = (cmd0, tokens) => {
  if (cmd0 !== "rm" || !hasRecursiveForce(tokens)) return null;
  const ops = operandsOf(tokens);
  return ops.length === 0 || ops.some(isRootishPath) ? "rm -rf of a root/home/glob path" : null;
};

const mkfsCheck: SegmentCheck = (cmd0) => (cmd0.startsWith("mkfs") ? "mkfs on a device" : null);

const ddCheck: SegmentCheck = (cmd0, tokens) => {
  if (cmd0 !== "dd") return null;
  return tokens.some((t) => unquote(t).startsWith("of=/dev/")) ? "dd writing to a device" : null;
};

const gitForceCheck: SegmentCheck = (cmd0, tokens) => {
  if (cmd0 !== "git" || !tokens.includes("push") || tokens.includes("--force-with-lease")) {
    return null;
  }
  const force = tokens.includes("--force") || tokens.some((t) => /^-[a-z]*f[a-z]*$/.test(t));
  return force ? "git push --force" : null;
};

const chmodCheck: SegmentCheck = (cmd0, tokens) => {
  if (cmd0 !== "chmod" || !hasRecursiveFlag(tokens)) return null;
  return operandsOf(tokens).some(isRootishPath) ? "chmod -R on a root path" : null;
};

const redirectCheck: SegmentCheck = (_cmd0, _tokens, seg) =>
  DEVICE_REDIRECT.test(seg) ? "redirect to a device" : null;

const SEGMENT_CHECKS: readonly SegmentCheck[] = [
  rmCheck,
  mkfsCheck,
  ddCheck,
  gitForceCheck,
  chmodCheck,
  redirectCheck,
];

/**
 * Returns a human reason if `cmd` contains a catastrophic command (in any
 * segment, across chains/sudo/pipes), else `null`.
 */
export function catastrophicShellReason(cmd: string): string | null {
  if (FORK_BOMB.test(cmd)) return "fork bomb";
  if (isCurlPipedToShell(cmd)) return "curl/wget piped into a shell";
  for (const seg of splitSegments(cmd)) {
    const tokens = stripPrefixTokens(tokenize(seg));
    const head = tokens[0];
    if (head === undefined) continue;
    const cmd0 = basename(unquote(head));
    for (const check of SEGMENT_CHECKS) {
      const reason = check(cmd0, tokens, seg);
      if (reason) return reason;
    }
  }
  return null;
}
