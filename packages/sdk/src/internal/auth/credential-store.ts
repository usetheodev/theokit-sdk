import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { z } from "zod";

/**
 * M42 — the SDK credential store. Promoted DOWN from agent-builder's hardened `agents/lib/credentials.ts`
 * (M37), generalized from a closed `openrouter|anthropic|openai` union to an open `provider: string` and
 * driven by a caller-supplied {@link CredentialStoreConfig} (no hardcoded `.agent-builder`/`auth.json` /
 * `AGENT_BUILDER_HOME`). The security-critical file mechanics are ported VERBATIM (ADR D3 of the M42 plan):
 * atomic O_EXCL + rename + fsync write, 0700/0600 mode gates, `env` is always a PARAMETER (never an ambient
 * `process.env` read). Contract SHAPE adapted from Upstream's provider `auth.loader` (MIT © 2025 upstream).
 *
 * The env-precedence + key-prefix-inference + declared-provider rungs of the agent-builder resolver are
 * APP POLICY and deliberately stay UP in the consumer; this module owns only the on-disk store + the
 * `api|oauth` discriminated union. See {@link resolveCredential} (SDK) for the store-read + refresh path.
 *
 * @internal
 */

/**
 * Where the credential store lives. Replaces agent-builder's hardcoded `.agent-builder`/`auth.json`/
 * `AGENT_BUILDER_HOME`. `homeEnvVar`, when set and present in `env`, overrides the whole directory
 * (mirroring Codex's `CODEX_HOME`) — so tests and multi-account setups point elsewhere without touching
 * `$HOME`. `env` is a PARAMETER for the same reason the store is: no ambient reads.
 */
export interface CredentialStoreConfig {
  /** Base home directory (e.g. `os.homedir()`). */
  home: string;
  /** The store subdirectory under `home` (e.g. `.agent-builder`, `.codex`). */
  dirName: string;
  /** The credential file name inside the store dir (e.g. `auth.json`). */
  fileName: string;
  /** Optional env var name that, when set + non-blank, overrides the full store dir. */
  homeEnvVar?: string;
}

/** The store directory, honoring an optional `homeEnvVar` override. */
export function credentialHome(
  config: CredentialStoreConfig,
  env: Record<string, string | undefined> = {},
): string {
  const override = config.homeEnvVar !== undefined ? env[config.homeEnvVar]?.trim() : undefined;
  return override !== undefined && override.length > 0 ? override : join(config.home, config.dirName);
}

/** The credential file path inside the (possibly overridden) store directory. */
export function authFilePath(
  config: CredentialStoreConfig,
  env: Record<string, string | undefined> = {},
): string {
  return join(credentialHome(config, env), config.fileName);
}

/** A credential problem the caller can act on. Never carries the key value. */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

/**
 * The flat bearer surface every consumer holds. `kind:'api'` is the classic API-key path; `kind:'oauth'`
 * is an OAuth session whose `apiKey` is the CURRENT access token, so consumers keep passing a flat bearer
 * string unchanged. `provider` is an open string (any registered provider name).
 */
export interface ResolvedCredential {
  kind: "api" | "oauth";
  provider: string;
  /** The effective BEARER the transport sends — an API key, or (oauth) the current access token. */
  apiKey: string;
  /** Where it came from — an env var NAME or a file path. Never the value. */
  source: string;
  /** True when the provider was derived rather than declared. */
  inferred: boolean;
  /** oauth only: epoch ms the access token expires. Drives the refresh in the oauth engine. */
  expiresAt?: number;
}

/**
 * The on-disk store — a discriminated union on `type` (Upstream `Info` shape). A legacy file with NO
 * `type` (or `type: 'api'`) is the API-key variant — read unchanged, no migration. The `oauth` variant
 * carries the token pair + expiry.
 */
const apiFileSchema = z
  .object({
    type: z.literal("api").optional(),
    provider: z.string().min(1).optional(),
    api_key: z.string(),
  })
  .strict();

const oauthFileSchema = z
  .object({
    type: z.literal("oauth"),
    provider: z.string().min(1),
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.number(),
    account_id: z.string().optional(),
  })
  .strict();

// oauth first (it requires `type: 'oauth'`); a legacy `{provider?, api_key}` falls through to api.
const fileSchema = z.union([oauthFileSchema, apiFileSchema]);

export interface StoredApiCredential {
  type?: "api";
  provider?: string;
  api_key: string;
}

export interface StoredOAuthCredential {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  /** Epoch ms the access token expires. */
  expires: number;
  account_id?: string;
}

export type StoredCredential = StoredApiCredential | StoredOAuthCredential;

/**
 * Read the credential file. Absent ⇒ `undefined` (the normal case). Present-but-wrong is a typed error
 * naming the file: a malformed credential store must not surface as a raw parse crash. Enforces the
 * 0700 dir / 0600 file mode gates (ported verbatim — a writable dir lets an attacker swap the file for a
 * symlink to their own account).
 */
export function readAuthFile(
  config: CredentialStoreConfig,
  env: Record<string, string | undefined> = {},
): StoredCredential | undefined {
  const path = authFilePath(config, env);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new CredentialError(`cannot read ${path}: ${(err as Error).message}`);
  }

  // The DIRECTORY matters as much as the file. `mkdirSync(mode)` applies only at creation, so a
  // pre-existing store dir keeps whatever mode it had. A writable dir lets an attacker replace the
  // credential file with a symlink to their own 0600 file — the agent then runs on THEIR account.
  const dirPath = credentialHome(config, env);
  const dirMode = statSync(dirPath).mode & 0o777;
  if ((dirMode & 0o022) !== 0) {
    throw new CredentialError(
      `${dirPath} is writable by other users (mode ${dirMode.toString(8)}), so the credential file ` +
        `inside it can be replaced. Fix it with:  chmod 700 ${dirPath}`,
    );
  }

  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new CredentialError(
      `${path} is readable by other users (mode ${mode.toString(8)}). ` +
        `A credential file must not be. Fix it with:  chmod 600 ${path}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser's message embeds a snippet of the INPUT — up to the raw key when a user pastes the bare
    // key instead of JSON. The position is not actionable anyway, so the expected shape is more useful.
    throw new CredentialError(
      `${path} is not valid JSON. Expected:  {"provider": "<name>", "api_key": "..."}`,
    );
  }

  try {
    return fileSchema.parse(parsed);
  } catch (err) {
    // A `z.union` reports a generic "Invalid input" at the root, hiding WHAT is wrong. Pick the sub-schema
    // the file was CLEARLY aiming at (by its `type` discriminant) and surface that schema's specific issue.
    const looksOAuth =
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "oauth";
    const specific = looksOAuth ? oauthFileSchema.safeParse(parsed) : apiFileSchema.safeParse(parsed);
    const issue = !specific.success
      ? specific.error.issues[0]
      : err instanceof z.ZodError
        ? err.issues[0]
        : undefined;
    throw new CredentialError(
      `${path}: ${issue?.message ?? String(err)} [${issue?.path.join(".") || "root"}]`,
    );
  }
}

/**
 * Read the stored OAuth credential (with its refresh token), or `undefined` when the store is absent or
 * holds an api credential. The oauth engine needs the refresh token, which the resolved bearer does not
 * carry. Enforces the same 0600/0700 gates as every other read.
 */
export function readStoredOAuth(
  config: CredentialStoreConfig,
  env: Record<string, string | undefined> = {},
): StoredOAuthCredential | undefined {
  const stored = readAuthFile(config, env);
  return stored !== undefined && stored.type === "oauth" ? stored : undefined;
}

/** Narrows a writable credential to the oauth variant. */
function isOAuthWrite(
  c: { provider: string; apiKey: string } | StoredOAuthCredential,
): c is StoredOAuthCredential {
  return "type" in c && c.type === "oauth";
}

/**
 * Persist a credential atomically at mode `0600`. Ported VERBATIM (ADR D3): write to a random-named temp
 * file in the same directory with `wx` (O_EXCL), fsync, close, chmod, then `rename` (atomic on POSIX) —
 * so a crash mid-write leaves whatever was there untouched, and a pre-planted symlink cannot capture the
 * key. The api variant persists the unchanged `{provider, api_key}` (back-compat, no `type` key); the
 * oauth variant persists `{type:'oauth', provider, access, refresh, expires, account_id?}`.
 */
export function writeCredential(
  cred: { provider: string; apiKey: string } | StoredOAuthCredential,
  config: CredentialStoreConfig,
  env: Record<string, string | undefined> = {},
): string {
  let payload: Record<string, unknown>;
  if (isOAuthWrite(cred)) {
    if (cred.access.length === 0 || cred.refresh.length === 0) {
      throw new CredentialError(
        "refusing to write an oauth credential with an empty access/refresh token",
      );
    }
    payload = {
      type: "oauth",
      provider: cred.provider,
      access: cred.access,
      refresh: cred.refresh,
      expires: cred.expires,
      ...(cred.account_id !== undefined ? { account_id: cred.account_id } : {}),
    };
  } else {
    if (typeof cred.apiKey !== "string" || cred.apiKey.length === 0) {
      throw new CredentialError("refusing to write an empty API key");
    }
    payload = { provider: cred.provider, api_key: cred.apiKey };
  }

  const dir = credentialHome(config, env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // unconditional: mkdirSync's mode applies only at creation

  const path = authFilePath(config, env);
  // RANDOM name + `wx` (O_EXCL): a predictable temp name with a plain write follows a pre-planted SYMLINK,
  // landing the key in an attacker's file while reporting success. O_EXCL refuses any pre-existing file or
  // link; the random suffix also removes the pid collision two containers sharing a bind-mounted home make.
  const tmp = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600); // explicit: the mode argument is subject to umask
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file may not exist; its absence is not a failure of the write
    }
    throw new CredentialError(`cannot write ${path}: ${(err as Error).message}`);
  }
  return path;
}
