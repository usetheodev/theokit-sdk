/**
 * `theokit acp` CLI subcommand — launches an ACP stdio server pointing at
 * the resolved entry file's default-exported `SDKAgent` or factory.
 *
 * Needs `@theokit/acp` installed in the consuming project (optional peer dependency of this package)
 * and an entry module whose default export is an `SDKAgent` or `(sessionId) => SDKAgent`.
 *
 * Exit codes: `0` when the host disconnects cleanly; `2` for a user error (entry not found, entry
 * exports the wrong thing, bad `--permission` or `--permission-timeout-ms`); `1` when the entry
 * throws on import, `@theokit/acp` is missing, or the server itself fails.
 *
 * ADRs D357 + EC-4 (CJS interop fallback).
 *
 * @internal
 */

import { pathToFileURL } from "node:url";
import { resolveEntry } from "../dev/entry-resolver.js";

/**
 * Flags for {@link runAcp}. All values arrive as strings from commander — the numeric and enum
 * checks live in this module, not in the type.
 */
export interface AcpOptions {
  /** Entry module. Defaults to `package.json` `main`, then `src/index.ts` and siblings. */
  entry?: string;
  /** `ask` (default), `auto`, or `deny`. Anything else exits 2. */
  permission?: "ask" | "auto" | "deny";
  /** Comma-separated tool names. Effective in `ask` mode ONLY — `deny` blocks these too. */
  trustedTools?: string;
  /** Positive integer, milliseconds. Anything else exits 2. Only used in `ask` mode. */
  permissionTimeoutMs?: string;
}

/**
 * Resolve the default export with CJS interop fallback (EC-4).
 *
 *   ESM:  `export default factory` → `mod.default === factory`
 *   CJS:  `module.exports = factory` → `mod.default === undefined`, `mod` IS factory
 */
function resolveDefaultExport(mod: unknown): unknown {
  if (mod === null || mod === undefined) return undefined;
  const asObj = mod as { default?: unknown };
  return asObj.default ?? mod;
}

function isValidAgentShape(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { agentId?: unknown; send?: unknown };
  return typeof obj.agentId === "string" && typeof obj.send === "function";
}

function fail(msg: string, code = 1): number {
  process.stderr.write(`theokit acp: ${msg}\n`);
  return code;
}

type ResolveAgentResult = { ok: true; agent: unknown } | { ok: false; exitCode: number };

async function loadAgentFromEntry(entryArg: string | undefined): Promise<ResolveAgentResult> {
  let entryPath: string;
  try {
    entryPath = resolveEntry(process.cwd(), entryArg);
  } catch (err) {
    return { ok: false, exitCode: fail(err instanceof Error ? err.message : String(err), 2) };
  }
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(entryPath).href);
  } catch (err) {
    return {
      ok: false,
      exitCode: fail(`failed to import entry: ${err instanceof Error ? err.message : err}`, 1),
    };
  }
  const agent = resolveDefaultExport(mod);
  if (!isValidAgentShape(agent)) {
    return {
      ok: false,
      exitCode: fail(
        `entry ${entryPath} must export an SDKAgent or a factory (sessionId) => SDKAgent. Got: ${typeof agent}`,
        2,
      ),
    };
  }
  return { ok: true, agent };
}

interface ParsedFlags {
  permission: "ask" | "auto" | "deny";
  trustedTools?: ReadonlyArray<string>;
  permissionTimeoutMs?: number;
}

type ParseFlagsResult = { ok: true; flags: ParsedFlags } | { ok: false; exitCode: number };

function parseTrustedTools(raw: string | undefined): ReadonlyArray<string> | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseTimeout(raw: string | undefined): { ok: true; value?: number } | { ok: false } {
  if (typeof raw !== "string") return { ok: true };
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

function parseFlags(opts: AcpOptions): ParseFlagsResult {
  const permission = opts.permission ?? "ask";
  if (permission !== "ask" && permission !== "auto" && permission !== "deny") {
    return { ok: false, exitCode: fail(`invalid --permission: ${permission}`, 2) };
  }
  const timeout = parseTimeout(opts.permissionTimeoutMs);
  if (!timeout.ok) {
    return {
      ok: false,
      exitCode: fail(`invalid --permission-timeout-ms: ${opts.permissionTimeoutMs}`, 2),
    };
  }
  const trustedTools = parseTrustedTools(opts.trustedTools);
  const flags: ParsedFlags = { permission };
  if (trustedTools !== undefined) flags.trustedTools = trustedTools;
  if (timeout.value !== undefined) flags.permissionTimeoutMs = timeout.value;
  return { ok: true, flags };
}

async function importServeAcp(): Promise<
  { ok: true; serveAcp: typeof import("@theokit/acp").serveAcp } | { ok: false; exitCode: number }
> {
  try {
    const mod = await import("@theokit/acp");
    return { ok: true, serveAcp: mod.serveAcp };
  } catch (err) {
    return {
      ok: false,
      exitCode: fail(
        `@theokit/acp not installed. Run: npm i @theokit/acp. (${err instanceof Error ? err.message : err})`,
        1,
      ),
    };
  }
}

/**
 * Load the entry's default export and serve it over ACP on stdio, blocking until the host
 * disconnects.
 *
 * Importing the entry EXECUTES it: top-level side effects (a server bound to a port, a `console.log`)
 * happen before the protocol starts, and anything written to stdout corrupts the JSON-RPC stream.
 *
 * The entry is validated by shape, not by type — any function passes, and a bad factory only fails
 * when the host opens its first session. Note the ordering: the entry is resolved and imported
 * BEFORE the flags are parsed, so an invalid `--permission` on a project with no entry file reports
 * the entry problem.
 *
 * Only four `AcpServerOptions` fields are wired here (`agent`, `permissionDefault`, `trustedTools`,
 * `permissionTimeoutMs`); `maxPromptBytes`, `capabilities`, `info` and `log` keep their defaults and
 * cannot be set from the command line.
 *
 * @returns the process exit code (0 / 1 / 2 as described at the top of this file).
 */
export async function runAcp(opts: AcpOptions): Promise<number> {
  const agentRes = await loadAgentFromEntry(opts.entry);
  if (!agentRes.ok) return agentRes.exitCode;

  const flagsRes = parseFlags(opts);
  if (!flagsRes.ok) return flagsRes.exitCode;

  const serveRes = await importServeAcp();
  if (!serveRes.ok) return serveRes.exitCode;

  try {
    await serveRes.serveAcp({
      agent: agentRes.agent as never,
      permissionDefault: flagsRes.flags.permission,
      ...(flagsRes.flags.trustedTools !== undefined
        ? { trustedTools: flagsRes.flags.trustedTools }
        : {}),
      ...(flagsRes.flags.permissionTimeoutMs !== undefined
        ? { permissionTimeoutMs: flagsRes.flags.permissionTimeoutMs }
        : {}),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 1);
  }
  return 0;
}

// Test seam
export { isValidAgentShape, resolveDefaultExport };
