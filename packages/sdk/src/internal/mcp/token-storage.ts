import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertSecureModes } from "../auth/credential-store.js";
import { diag } from "../diagnostics.js";
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

/**
 * Make the directory private BEFORE anything is written into it.
 *
 * `atomicWriteJson` auto-creates the parent with a bare recursive `mkdir`, so under the common umask
 * 002 `~/.theokit` was born 0775 — and the `chmod 600` applied to the file afterwards protects the
 * wrong thing. Write permission on a DIRECTORY is permission to unlink and recreate its contents, so
 * a 0600 file inside a group-writable directory can be replaced wholesale by another local user. The
 * secret here is a REFRESH TOKEN: replacing it swaps which account the agent authenticates as.
 *
 * The `chmod` is unconditional and not a fallback for the `mkdir` mode: `mkdir`'s mode applies only
 * at CREATION, so every machine that already ran an older build has the loose directory sitting
 * there, and a fix that only covers fresh installs does not reach the population that has the
 * problem.
 */
function ensurePrivateStoreDir(): void {
  const dir = dirname(FILE_PATH);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  } catch {
    // Windows: chmod is a no-op and the mode argument is meaningless. Same posture as the file
    // chmod below — documented in ADR D41 / EC-14.
  }
}

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
      diag(
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
 */
export async function setTokens(serverName: string, tokens: OAuthTokens): Promise<void> {
  const kt = tryRequireKeytar();
  const payload = JSON.stringify(tokens);
  if (kt !== null && kt !== undefined) {
    await kt.setPassword(KEYTAR_SERVICE, serverName, payload);
    return;
  }
  // File fallback. The directory is locked down first — see `ensurePrivateStoreDir`.
  ensurePrivateStoreDir();
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
  // The same gate the credential file gets, and deliberately the same implementation rather than a
  // second one: a refresh token is a credential, and `assertSecureModes` already carries the attack
  // it defends against in its docstring. It is called OUTSIDE the try/catch on purpose — the catch
  // below exists to treat a corrupt file as absent, and letting it swallow this would turn "someone
  // else can replace your token" into a silent `undefined`, which reads as "not logged in".
  assertSecureModes(dirname(FILE_PATH), FILE_PATH);
  try {
    const all = JSON.parse(readFileSync(FILE_PATH, "utf8")) as Record<string, OAuthTokens>;
    return all[serverName];
  } catch {
    return undefined;
  }
}

/**
 * Serialize concurrent refresh attempts per server (EC-9). If a refresh is
 * already in flight for the same `serverName`, the second caller awaits
 * the same Promise.
 *
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
