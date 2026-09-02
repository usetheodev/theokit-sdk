import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertSecureModes } from "../auth/credential-store.js";
import { diag } from "../diagnostics.js";
import { atomicWriteJson } from "../persistence/atomic-write.js";

/**
 * The OAuth tokens held for one MCP server. See ADR D41.
 *
 * Persisted per server name by `setTokens` and returned unchanged by `getTokens`. Where it lands
 * depends on what is installed: `keytar` puts the serialized bundle in the OS keychain, and
 * without it the bundle is written to a JSON file at mode 0600 inside a 0700 directory — in
 * PLAINTEXT, keyed by server name alongside every other server's tokens. Nothing here encrypts it.
 *
 * `refreshToken` is the field that matters most and the field that is optional. When present it
 * outlives `accessToken` and can mint new ones, so a leaked store is a persistent compromise of
 * the account rather than a temporary one. When absent, an expired access token means re-running
 * the authorization flow.
 *
 * `expiresAt` and `obtainedAt` are both epoch milliseconds and both describe the ACCESS token —
 * when it stops working, and when this bundle was issued. Nothing records when the refresh token
 * expires, so a refresh rejected because the grant itself lapsed is only discovered at the token
 * endpoint.
 *
 * The value is not validated on read: whatever JSON was stored is cast to this shape, so a
 * hand-edited or truncated store yields an object whose fields may be missing rather than an
 * error.
 *
 * `scope` records what the token was granted, as the server returned it. It is stored for
 * inspection; nothing in this module enforces it.
 *
 * @public — re-exported from `@theokit/sdk/mcp-auth`, and therefore under semver.
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
 * The environment variable is read FIRST and `homedir()` is the fallback, and the variable READ IS
 * PER PLATFORM because `os.homedir()` itself is: on POSIX it prefers `$HOME`, on Windows it reads
 * `USERPROFILE` and never consults `HOME`. Mirroring that split is what keeps this a pure
 * binding-time fix instead of a behaviour change.
 *
 * A previous revision read `process.env.HOME` on every platform. Review caught it: under Git Bash,
 * MSYS2 or Cygwin `HOME` IS set, to a POSIX-shaped path, and `path.win32.join("/c/Users/N", ...)`
 * yields `\c\Users\N\.theokit\...` where `USERPROFILE` would have given
 * `C:\Users\N\.theokit\...`. That would have hidden every existing token on those setups and
 * written a new credential file to a drive-relative path. It was published as "on Windows HOME is
 * typically unset" — an untested platform claim, and the same defect class it was written to fix.
 *
 * Why read the env at all: inside a worker thread `process.env` is a JS-level copy while
 * `os.homedir()` is a native call reading the real process environment, so code that moves the home
 * inside a worker is invisible to `homedir()`. Reading the env first makes this module independent
 * of the execution model, not just of the import moment.
 *
 * The empty/whitespace guard falls through to `homedir()`, and it buys LESS than two earlier
 * revisions of this comment claimed. Measured on POSIX: `homedir()` with `HOME=""` returns `""` and
 * with `HOME="   "` returns `"   "` untrimmed, so the fallback hands back the same value the guard
 * rejected — close to a no-op. `path.join("", ".theokit", ...)` yields a CWD-RELATIVE
 * `.theokit/mcp-tokens.json`, never `/.theokit`; an earlier revision named that as the hazard and it
 * does not exist.
 *
 * On Windows it is UNKNOWN rather than load-bearing: the fallback reads the same `USERPROFILE`, so
 * whether the guard changes anything depends on whether an empty variable is reported as absent
 * there, which is untested and not asserted here. The one case where the guard is genuinely
 * load-bearing is a worker thread whose environment copy was blanked.
 *
 * The OS is UNTESTED here: every POSIX-mode test in `mcp/token-store-modes.test.ts` is
 * `it.skipIf(!POSIX)` and CI runs ubuntu only, so nothing exercises real Windows chmod semantics or
 * libuv's `USERPROFILE` lookup. The BRANCH SELECTION is tested — `process.platform` is spy-able, and
 * `test_the_store_reads_USERPROFILE_and_not_HOME_on_win32` pins all three legs.
 *
 * The split is reasoned from `os.homedir()`'s documented per-platform source. A previous revision
 * also cited `internal/runtime/fixtures/fixture-mode.ts:119` as support; that citation was WRONG and
 * is removed rather than quietly dropped. That line reads `process.env.HOME ?? process.env.USERPROFILE`
 * — HOME-first on every platform, which is the exact shape this split exists to avoid. It supports
 * the rejected alternative, not this one. (That the two modules now resolve different homes under
 * Git Bash is real and is filed separately; `fixture-mode` only probes for `~/.aws/credentials`.)
 *
 * Measured cost, not asserted: `homedir()` is 151 ns/op against 13 382 for the read this path
 * performs and 97 079 for the write (89x and 645x). The resolution is free relative to the I/O it
 * precedes.
 *
 * B-089. `packages/sdk/tests/mcp/token-store-modes.test.ts` pins it: import once, move HOME, write,
 * assert the write followed — and it must hold under `--pool=threads`, not only under the repo's
 * configured `forks`.
 *
 * B-090 — `THEOKIT_HOME` now WINS over the home-anchored default, and the reason is not tidiness.
 * `vitest.setup.ts` isolates every test in this package by pointing `THEOKIT_HOME` at a fresh
 * tmpdir; it backs `HOME` up and never sets it. A home-anchored module that ignored the variable
 * therefore resolved to the developer's REAL `~` while the suite believed it was isolated — and it
 * did: a default-config run deposited four refresh-token entries (`test-srv`, `srv-2`, `srv-race`,
 * `srv-roundtrip`) into `~/.theokit/mcp-tokens.json` from `tests/golden/mcp/oauth.golden.test.ts`.
 * A suite that is wrong about its own isolation is a false green about the one property the rest of
 * its greens rest on.
 *
 * **This is the code catching up to a contract the SDK already published**, not a new policy.
 * `src/project-env.ts:47-49` documents `THEOKIT_HOME` as "Locates the SDK home — sessions, AND THE
 * CREDENTIAL STORE BENEATH IT", and it is listed there as a sovereign key precisely because it
 * governs where credentials live. The public contract already said the store sits under the
 * variable; this module was the half that disagreed.
 *
 * The resolver adopted is `transcriptRoot()`'s (`internal/persistence/session-transcript.ts`), NOT
 * `paths.ts`'s `getTheokitHome(cwd)`. The transcript is the sibling with the right SHAPE: home-anchored
 * default, `THEOKIT_HOME` override, trimmed, empty-guarded — and its docstring records that before M94
 * it ignored the variable, so "whoever set it had their state split in two silently", which is this
 * defect verbatim. M94 ADR-2 already accepted that migration for identically-shaped state.
 * `getTheokitHome(cwd)` falls back to `<cwd>/.theokit`, so adopting IT would move the token file of
 * everyone who does not set the variable — and to a DIFFERENT place per working directory, making
 * whether you are logged in a property of which folder you launched from.
 *
 * **The migration this does carry**, stated rather than buried: a user who already holds
 * `~/.theokit/mcp-tokens.json` AND sets `THEOKIT_HOME` stops seeing those tokens. `getTokens` returns
 * `undefined`, which the caller surfaces as "not logged in", and the OAuth flow re-runs. Nothing is
 * deleted and nothing is overwritten — the old file stays where it is and is picked up again the
 * moment the variable is unset. No migration step is performed on the user's behalf, because
 * silently moving a credential file is a worse failure than a re-auth. Users who do NOT set
 * `THEOKIT_HOME` — the default — see no change at all.
 *
 * **Two further consequences for those who DO set it**, both on the directory-mode path rather than
 * on the path resolution, and both spelled out at {@link ensurePrivateStoreDir}: the store no longer
 * re-permissions a `$THEOKIT_HOME` it did not create, and `getTokens` REFUSES — typed, loud — to read
 * out of a group- or world-writable one instead of returning `undefined`.
 */
function storeFilePath(): string {
  return storeLocation().file;
}

/**
 * Where the store lives, and whether that directory is OURS.
 *
 * `ours` is not bookkeeping — it decides whether this module is entitled to change the directory's
 * permissions. `<home>/.theokit` is a directory the SDK creates and owns; a `THEOKIT_HOME` root is
 * one the operator chose and may share with other state. See {@link ensurePrivateStoreDir}.
 */
interface StoreLocation {
  readonly dir: string;
  readonly file: string;
  readonly ours: boolean;
}

/**
 * The directory the token file lives in: `THEOKIT_HOME` when usable, `<home>/.theokit` otherwise.
 *
 * The empty/whitespace guard on the override is load-bearing in a way the HOME guard below is not:
 * `THEOKIT_HOME=""` with no guard resolves the store to a CWD-RELATIVE `mcp-tokens.json`, and
 * `THEOKIT_HOME="   "` to a directory literally named three spaces. Neither falls back to anything;
 * both are new locations invented from an unusable value. `transcriptRoot()` guards it for the same
 * reason.
 */
function storeLocation(): StoreLocation {
  const override = process.env.THEOKIT_HOME?.trim();
  if (override !== undefined && override.length > 0) {
    return { dir: override, file: join(override, "mcp-tokens.json"), ours: false };
  }
  // Mirrors `os.homedir()`'s own per-platform source: USERPROFILE on Windows, HOME elsewhere.
  const fromEnv =
    process.platform === "win32" ? process.env.USERPROFILE?.trim() : process.env.HOME?.trim();
  const home = fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : homedir();
  const dir = join(home, ".theokit");
  return { dir, file: join(dir, "mcp-tokens.json"), ours: true };
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
 * **The retro-fix `chmod` is scoped to directories we own, and B-090 is why.** It was written
 * unconditional for a specific reason: `mkdir`'s mode applies only at CREATION, so every machine
 * that already ran an older build has a loose `~/.theokit` sitting there, and a fix that only covers
 * fresh installs does not reach the population that has the problem. That reasoning names its own
 * population — directories THIS MODULE created in an older build. Once `THEOKIT_HOME` is honoured,
 * an unconditional `chmod` also reaches a root the operator chose, which we never created and which
 * `paths.ts` documents as a multi-tenant deployment knob. Measured: it silently demoted a 0775
 * `$THEOKIT_HOME` to 0700, taking the sessions, transcripts, personality and credential-pool state
 * that share that root with it. No other consumer of the variable imposes a mode on it.
 *
 * So: always `mkdir` at 0700 (a directory WE create is born private wherever it is), and `chmod` an
 * existing one only when it is `<home>/.theokit`.
 *
 * The `chmod` deliberately does NOT also cover "we just created it". A first draft guarded it with
 * `ours || created !== undefined`; mutating that to plain `ours` killed no test, and the reason is
 * that the disjunct cannot make a difference: a umask only CLEARS bits, and 0700 carries none in the
 * group/other range, so `mkdir(0700)` is private for every possible umask. The redundant clause was
 * removed rather than pinned with a test written to justify it.
 *
 * **What that leaves, stated rather than left to be discovered.** A pre-existing group-writable
 * `$THEOKIT_HOME` is no longer repaired, so the next {@link getTokens} throws `CredentialError` from
 * `assertSecureModes` naming the directory and the `chmod 700` that fixes it. That is the intended
 * end state: a refresh token under a directory any local user can replace files in is not safe to
 * return, and the two available alternatives are worse. Silently tightening the operator's root
 * breaks their deployment to protect them from a choice they may have made deliberately; silently
 * returning the token hands the caller a credential that may already have been swapped. A loud,
 * actionable refusal is the only option that neither mutates someone else's directory nor lies about
 * what it read.
 *
 * The asymmetry that remains is real and is NOT fixed here: the write path has no such gate, so
 * `setTokens` will happily write into that directory and the following `getTokens` refuses it.
 * Adding a write-side gate is a separate behaviour change on a path that currently always succeeds.
 */
function ensurePrivateStoreDir({ dir, ours }: StoreLocation): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (ours) chmodSync(dir, 0o700);
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
      // The path is RESOLVED rather than spelled `~/.theokit/mcp-tokens.json`. That literal was
      // correct until B-090 made `THEOKIT_HOME` win, at which point a message naming a fixed
      // location would send anyone who sets the variable to look at a file the store no longer
      // writes — a diagnostic that lies costs more than one that is absent.
      diag(
        `[theokit-sdk] keytar not installed; MCP OAuth tokens will be stored in ${storeFilePath()} (chmod 600 where POSIX). Install \`keytar\` for OS keychain storage.\n`,
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
  const location = storeLocation();
  const filePath = location.file;
  ensurePrivateStoreDir(location);
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
