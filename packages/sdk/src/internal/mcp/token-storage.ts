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
/**
 * Resolve the store path on every call instead of binding it once at module load.
 *
 * This used to be `const FILE_PATH = join(homedir(), ...)`. A module-level constant captures
 * ambient global state at IMPORT, so the store kept writing to whichever HOME was set when the
 * module first loaded and never noticed a later change. In production that is invisible, because
 * HOME does not move mid-process — but it made the module's correctness a property of *when* it was
 * imported, which is not a property a credential store should have.
 *
 * `process.env.HOME` is read FIRST and `homedir()` is the fallback, which is not a stylistic
 * preference. On POSIX `os.homedir()` already prefers `$HOME`, so in a normal process the two are
 * byte-identical; on Windows `HOME` is typically unset and the fallback runs, which is also the
 * behaviour that shipped before. They diverge in exactly one place: inside a worker thread,
 * `process.env` is a JS-level copy while `os.homedir()` is a native call reading the real process
 * environment — so code that moves `HOME` in a worker is invisible to `homedir()`. Reading the env
 * first is what makes this module independent of the execution model rather than of the import
 * moment alone.
 *
 * The empty-string guard is load-bearing: `HOME=""` must fall through rather than resolve the store
 * to `/.theokit`. Same idiom as `internal/persistence/paths.ts` and `session-transcript.ts`, reused
 * rather than re-invented.
 *
 * Measured cost, not asserted: `homedir()` is 151 ns/op against 13 382 for the read this path
 * performs and 97 079 for the write (89x and 645x). The resolution is free relative to the I/O it
 * precedes.
 *
 * B-089. `packages/sdk/tests/mcp-token-store-modes.test.ts` pins it: import once, move HOME, write,
 * assert the write followed — and it must hold under `--pool=threads`, not only under the repo's
 * configured `forks`.
 *
 * `THEOKIT_HOME` is deliberately NOT honoured here; see B-090. `transcriptRoot()` does honour it and
 * M94 ADR-2 accepted that migration for the sibling module, but doing the same for a credential
 * store changes what existing token holders see, and that is a product decision rather than a
 * prerequisite for execution-model independence.
 */
function storeFilePath(): string {
  const fromEnv = process.env.HOME?.trim();
  const home = fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : homedir();
  return join(home, ".theokit", "mcp-tokens.json");
}

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
function ensurePrivateStoreDir(filePath: string): void {
  const dir = dirname(filePath);
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
  // Resolved once for the whole operation and PASSED DOWN. Resolving per use would let a read and
  // the write that follows it disagree if HOME moved in between — and `ensurePrivateStoreDir`
  // resolving its own copy would let the directory be locked down under one home while the token
  // lands under another. Today those two statements are adjacent and synchronous so they cannot
  // diverge, but that is incidental; passing the path makes the invariant structural.
  const filePath = storeFilePath();
  ensurePrivateStoreDir(filePath);
  let allTokens: Record<string, OAuthTokens> = {};
  if (existsSync(filePath)) {
    try {
      allTokens = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, OAuthTokens>;
    } catch {
      // corrupt file — start fresh
      allTokens = {};
    }
  }
  allTokens[serverName] = tokens;
  await atomicWriteJson(filePath, allTokens);
  try {
    chmodSync(filePath, 0o600);
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
  const filePath = storeFilePath();
  if (!existsSync(filePath)) return undefined;
  // The same gate the credential file gets, and deliberately the same implementation rather than a
  // second one: a refresh token is a credential, and `assertSecureModes` already carries the attack
  // it defends against in its docstring. It is called OUTSIDE the try/catch on purpose — the catch
  // below exists to treat a corrupt file as absent, and letting it swallow this would turn "someone
  // else can replace your token" into a silent `undefined`, which reads as "not logged in".
  assertSecureModes(dirname(filePath), filePath);
  try {
    const all = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, OAuthTokens>;
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
