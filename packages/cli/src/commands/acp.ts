/**
 * `theokit acp` CLI subcommand — launches an ACP stdio server pointing at
 * the resolved entry file's default-exported `SDKAgent` or factory.
 *
 * ADRs D357 + EC-4 (CJS interop fallback).
 *
 * @internal
 */

import { pathToFileURL } from "node:url";
import { resolveEntry } from "../dev/entry-resolver.js";

export interface AcpOptions {
  entry?: string;
  permission?: "ask" | "auto" | "deny";
  trustedTools?: string;
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
  { ok: true; serveAcp: typeof import("@usetheo/acp").serveAcp } | { ok: false; exitCode: number }
> {
  try {
    const mod = await import("@usetheo/acp");
    return { ok: true, serveAcp: mod.serveAcp };
  } catch (err) {
    return {
      ok: false,
      exitCode: fail(
        `@usetheo/acp not installed. Run: npm i @usetheo/acp. (${err instanceof Error ? err.message : err})`,
        1,
      ),
    };
  }
}

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
