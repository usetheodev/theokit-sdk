/**
 * Catastrophic-command guardrail for `shell_exec` (M3-2; hardened V3-1).
 *
 * `catastrophicShellReason` is a pure, segment-aware deny-list ported from
 * theocode's security-reviewed `shell-guard.ts` (the proven spec: 42-blocked +
 * 24-allowed corpus, 0 misses / 0 false-positives). It splits a command on shell
 * separators (`;`, `&&`, `||`, `|`, `&`, newline), inspects EVERY segment (so a
 * chained `rm -rf <safe>; rm -rf /` cannot hide), and matches at COMMAND POSITION
 * (the executable, not an arbitrary substring) so a mention like `echo "rm -rf /"`
 * is not over-blocked. Returns a human reason for the first catastrophic segment,
 * else `null`.
 *
 * Categories: recursive-force `rm` of an absolute/home/parent path; destructive git
 * (force-push, `reset --hard`, `clean -fd`); remote-code-execution (curl/wget piped
 * OR command-substitution `$( )` / `<( )` / eval / source); disk/raw-device wipe
 * (mkfs, `dd of=/dev/`, `truncate /dev/`, `> /dev/<blockdev>`); recursive chmod/chown
 * of a root path (SDK extra); fork bomb; `find -delete` / `-exec rm`; secret-file
 * exfiltration over the network.
 *
 * This is a heuristic GUARDRAIL, NOT a sandbox: it is bypassable by deep obfuscation
 * (base64/env-indirection) and is best-effort. POSIX `/bin/sh` only; Windows
 * PowerShell is out of scope. True isolation needs a container.
 * referencia: .claude/knowledge-base/references/theocode-shell-guard/server-lib/shell-guard.ts
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

/** Strip a single layer of surrounding quotes from a token (so `"/"` -> `/`). */
function unquote(token: string): string {
  return token.replace(/^(['"])(.*)\1$/, "$2").replace(/^['"]|['"]$/g, "");
}

/**
 * Split a command line into statement segments on shell separators
 * (`;`, `&&`, `||`, `|`, `&`, newline). The rm screen inspects EVERY segment (C1).
 * Quote-aware splitting is out of scope (a guardrail, not a parser).
 */
function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|&\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Arg tokens of a segment whose command is `name` (after an optional `sudo`); `null` otherwise. */
function commandArgs(segment: string, name: string): string[] | null {
  const tokens = segment.split(/\s+/);
  let i = 0;
  if (tokens[i] === "sudo") i += 1;
  if (tokens[i] !== name) return null; // must be the COMMAND, not a substring/arg
  return tokens.slice(i + 1);
}

/** Every segment whose command is `name` -> its arg list. */
function commandSegmentsNamed(command: string, name: string): string[][] {
  return commandSegments(command)
    .map((s) => commandArgs(s, name))
    .filter((args): args is string[] => args !== null);
}

/** Does an arg list carry BOTH a recursive and a force flag, in ANY position/spelling? */
function isRecursiveForce(args: string[]): boolean {
  const flags = args.filter((t) => t.startsWith("-")).join(" ");
  if (flags.length === 0) return false;
  const recursive = /-[a-z]*r/i.test(flags) || /--recursive/.test(flags);
  const force = /-[a-z]*f/i.test(flags) || /--force/.test(flags);
  return recursive && force;
}

/** Does an arg list carry a recursive flag (for chmod/chown -R)? */
function isRecursive(args: string[]): boolean {
  const flags = args.filter((t) => t.startsWith("-")).join(" ");
  return /-[a-z]*r/i.test(flags) || /--recursive/.test(flags);
}

/** Absolute paths that are safe to recursively delete (scratch/throwaway). */
const SAFE_ABSOLUTE_TARGET = /^\/(tmp|var\/tmp)(\/|$)/;

/** True when an arg list targets root, home, `$HOME`, an absolute path, or `..`. */
function targetsDangerousPath(args: string[]): boolean {
  const targets = args.filter((token) => token.length > 0 && !token.startsWith("-")).map(unquote);
  return targets.some((raw) => {
    const t = raw.replace(/\/+/g, "/"); // collapse `//` -> `/` (SDK extra)
    if (t === "/dev/null" || SAFE_ABSOLUTE_TARGET.test(t)) return false;
    return (
      /^\/($|\*)/.test(t) || // "/" or "/*"
      /^\/[^/]/.test(t) || // an absolute path like /etc, /usr/local, /home/user/x
      t === "~" ||
      t.startsWith("~/") ||
      /\$\{?HOME\b\}?/.test(t) || // $HOME or ${HOME}
      t === ".." ||
      t.startsWith("../") ||
      t.includes("/..") ||
      t === "*"
    );
  });
}

/** mkfs / dd-to-device / truncate-device / redirect-to-blockdev (families incl. SDK extras). */
const DEVICE_WIPE = [
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^\n]*\bof=\/dev\//,
  /\btruncate\b[^\n]*\s\/dev\//,
  />\s*\/dev\/(sd|nvme|hd|vd|mmcblk|disk|loop|dm-)/,
];

/** A single catastrophic-category screen: returns a reason or `null`. */
type CategoryCheck = (cmd: string) => string | null;

/** Remote code execution: a remote download fed into an interpreter (pipe / `$( )` / `<( )` / eval / source). */
const checkRemoteExec: CategoryCheck = (cmd) =>
  /\b(curl|wget|fetch)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|python[0-9.]*|node|ruby|perl)\b/i.test(
    cmd,
  ) ||
  /(\$\(|<\()\s*(sudo\s+)?(curl|wget|fetch)\b/i.test(cmd) ||
  /\b(eval|source)\b[^\n]*\b(curl|wget|fetch)\b/i.test(cmd)
    ? "executes a remote download (pipe / command-substitution / eval) — remote code execution"
    : null;

/** Disk / raw block-device wipe (mkfs, dd-to-device, truncate-device, redirect-to-blockdev). */
const checkDeviceWipe: CategoryCheck = (cmd) =>
  DEVICE_WIPE.some((re) => re.test(cmd)) ? "writes to a raw block device / formats a disk" : null;

/** Fork bomb. */
const checkForkBomb: CategoryCheck = (cmd) =>
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd) ? "fork bomb" : null;

/** Destructive git: force-push (NOT --force-with-lease), hard reset, aggressive clean. */
const checkDestructiveGit: CategoryCheck = (cmd) => {
  if (/\bgit\b[^\n]*\bpush\b[^\n]*(--force(?!-with-lease)\b|\s-f\b|\s\+\S)/.test(cmd)) {
    return "git force-push (overwrites remote history)";
  }
  if (/\bgit\b[^\n]*\breset\b[^\n]*--hard\b/.test(cmd)) {
    return "git reset --hard (discards committed and working changes)";
  }
  if (/\bgit\b[^\n]*\bclean\b[^\n]*(-[a-z]*f[a-z]*d|-[a-z]*d[a-z]*f)/.test(cmd)) {
    return "git clean -fd (permanently deletes untracked files)";
  }
  return null;
};

/** Recursive force-delete of a path outside the workspace — checked on EVERY rm segment (C1). */
const checkRm: CategoryCheck = (cmd) =>
  commandSegmentsNamed(cmd, "rm").some((a) => isRecursiveForce(a) && targetsDangerousPath(a))
    ? "recursive force-delete of an absolute, home, or parent path"
    : null;

/** Recursive chmod/chown of a root/home/parent path (SDK extra — not in theocode). */
const checkPerm: CategoryCheck = (cmd) =>
  (["chmod", "chown"] as const).some((name) =>
    commandSegmentsNamed(cmd, name).some((a) => isRecursive(a) && targetsDangerousPath(a)),
  )
    ? "recursive permission change on an absolute, home, or parent path"
    : null;

/** find with -delete / -exec rm targeting an absolute or home root. */
const checkFind: CategoryCheck = (cmd) =>
  /\bfind\s+(\/\S*|~\S*|\$\{?HOME\}?\S*)\s[^\n]*(-delete\b|-exec\s+rm\b)/.test(cmd)
    ? "find -delete / -exec rm on an absolute or home path"
    : null;

/** Exfiltration: a secret/credential file referenced together with a network sender. */
const checkExfiltration: CategoryCheck = (cmd) => {
  const touchesSecret =
    /(^|[\s/'"])(\.env(\.\w+)?|id_rsa|id_ed25519|\.ssh(\/|\b)|credentials|\.aws(\/|\b)|\.npmrc)\b/.test(
      cmd,
    );
  const sendsNetwork =
    /\b(curl|wget|nc|netcat|scp|ftp|telnet)\b/.test(cmd) || /\bpython[0-9.]*\s+-m\s+http/.test(cmd);
  return touchesSecret && sendsNetwork
    ? "sends a secret/credential file over the network (exfiltration)"
    : null;
};

const CATEGORY_CHECKS: readonly CategoryCheck[] = [
  checkRemoteExec,
  checkDeviceWipe,
  checkForkBomb,
  checkDestructiveGit,
  checkRm,
  checkPerm,
  checkFind,
  checkExfiltration,
];

/**
 * Return a human-readable reason when `command` is catastrophic/irreversible, or `null`.
 * The message is surfaced to the model so it self-corrects.
 */
export function catastrophicShellReason(command: string): string | null {
  const cmd = command.trim();
  if (cmd.length === 0) return null;
  for (const check of CATEGORY_CHECKS) {
    const reason = check(cmd);
    if (reason) return reason;
  }
  return null;
}
