import { chmodSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import { atomicWriteJson } from "../persistence/atomic-write.js";

/**
 * OAuth token bundle persisted per MCP server. See ADR D41.
 *
 * @internal
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // ms epoch
  scope?: string;
  obtainedAt: number; // ms epoch
}

const KEYTAR_SERVICE = "theokit-mcp";
const FILE_PATH = join(homedir(), ".theokit", "mcp-tokens.json");

interface KeytarLike {
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
}

let keytarWarned = false;
let cachedKeytar: KeytarLike | undefined | null;
function tryRequireKeytar(): KeytarLike | null {
  if (cachedKeytar !== undefined) return cachedKeytar;
  try {
    const r = createRequire(import.meta.url);
    cachedKeytar = r("keytar") as KeytarLike;
  } catch {
    if (!keytarWarned) {
      process.stderr.write(
        "[theokit-sdk] keytar not installed; MCP OAuth tokens will be stored in ~/.theokit/mcp-tokens.json (chmod 600 where POSIX). Install `keytar` for OS keychain storage.\n",
      );
      keytarWarned = true;
    }
    cachedKeytar = null;
  }
  return cachedKeytar;
}

// EC-9 (race): serialize concurrent refreshes per server. Each key maps to
// the in-flight refresh Promise; subsequent callers await the same promise.
const inflightRefresh = new Map<string, Promise<OAuthTokens>>();

/**
 * Persist tokens for `serverName`. Tries keychain first, falls back to file
 * with chmod 600 (POSIX). Idempotent.
 *
 * @internal
 */
export async function setTokens(serverName: string, tokens: OAuthTokens): Promise<void> {
  const kt = tryRequireKeytar();
  const payload = JSON.stringify(tokens);
  if (kt !== null && kt !== undefined) {
    await kt.setPassword(KEYTAR_SERVICE, serverName, payload);
    return;
  }
  // File fallback. atomicWriteJson auto-creates the parent directory.
  let allTokens: Record<string, OAuthTokens> = {};
  if (existsSync(FILE_PATH)) {
    try {
      allTokens = JSON.parse(readFileSync(FILE_PATH, "utf8")) as Record<string, OAuthTokens>;
    } catch {
      // corrupt file — start fresh
      allTokens = {};
    }
  }
  allTokens[serverName] = tokens;
  await atomicWriteJson(FILE_PATH, allTokens);
  try {
    chmodSync(FILE_PATH, 0o600);
  } catch {
    // Windows: chmod is a no-op. Documented in ADR D41 / EC-14.
  }
}

/**
 * Retrieve tokens for `serverName`. Returns undefined if absent.
 *
 * @internal
 */
export async function getTokens(serverName: string): Promise<OAuthTokens | undefined> {
  const kt = tryRequireKeytar();
  if (kt !== null && kt !== undefined) {
    const value = await kt.getPassword(KEYTAR_SERVICE, serverName);
    if (typeof value !== "string") return undefined;
    try {
      return JSON.parse(value) as OAuthTokens;
    } catch {
      return undefined;
    }
  }
  if (!existsSync(FILE_PATH)) return undefined;
  try {
    const all = JSON.parse(readFileSync(FILE_PATH, "utf8")) as Record<string, OAuthTokens>;
    return all[serverName];
  } catch {
    return undefined;
  }
}

/**
 * Delete tokens for `serverName`. Idempotent.
 *
 * @internal
 */
export async function deleteTokens(serverName: string): Promise<void> {
  const kt = tryRequireKeytar();
  if (kt !== null && kt !== undefined) {
    await kt.deletePassword(KEYTAR_SERVICE, serverName);
    return;
  }
  if (!existsSync(FILE_PATH)) return;
  try {
    const all = JSON.parse(readFileSync(FILE_PATH, "utf8")) as Record<string, OAuthTokens>;
    delete all[serverName];
    await atomicWriteJson(FILE_PATH, all);
  } catch {
    // ignore
  }
}

/**
 * Serialize concurrent refresh attempts per server (EC-9). If a refresh is
 * already in flight for the same `serverName`, the second caller awaits
 * the same Promise.
 *
 * @internal
 */
export function lockedRefresh(
  serverName: string,
  refreshFn: () => Promise<OAuthTokens>,
): Promise<OAuthTokens> {
  const existing = inflightRefresh.get(serverName);
  if (existing !== undefined) return existing;
  const promise = (async () => {
    try {
      return await refreshFn();
    } finally {
      inflightRefresh.delete(serverName);
    }
  })();
  inflightRefresh.set(serverName, promise);
  return promise;
}

/**
 * Reset all cached state. Test-only helper.
 *
 * @internal
 */
export function _resetForTests(): void {
  inflightRefresh.clear();
  cachedKeytar = undefined;
  keytarWarned = false;
}
