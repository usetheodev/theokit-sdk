/**
 * Child-process environment policy (#54).
 *
 * Every subprocess the SDK spawns previously inherited the FULL `process.env`,
 * so API keys, tokens and passwords leaked into hook scripts and shell tools.
 * `resolveChildEnv` computes the env a child receives under an explicit policy.
 *
 * Modes:
 *  - `inherit-scrubbed` (DEFAULT) — inherit all parent vars EXCEPT secret-like
 *    names (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*_AUTH*`). Non-breaking:
 *    existing spawns keep every non-secret var; only secrets stop leaking.
 *  - `core` — inherit ONLY a safe base allowlist (PATH/HOME/…); strongest scrub.
 *  - `all` — explicit opt-out: inherit everything, secrets included.
 *
 * Explicit `overrides` ALWAYS win (merged last), so a tool can re-inject a var
 * it genuinely needs even under a scrubbing policy.
 *
 * @internal
 */

import type { EnvPolicy } from "../../../types/env-policy.js";

// The `EnvPolicy` contract now lives in the domain `types/` layer (SE46 DIP
// direction). Re-exported here so existing importers of this module keep
// resolving the same name.
export type { EnvPolicy } from "../../../types/env-policy.js";

export interface ResolveChildEnvOptions {
  /** Source env to derive from. Defaults to `process.env`. */
  parent?: Record<string, string | undefined>;
  /** Inherit/scrub policy. Defaults to `inherit-scrubbed`. */
  policy?: EnvPolicy;
  /** Explicit vars merged AFTER the policy — always win. */
  overrides?: Record<string, string>;
}

/**
 * Secret-like variable-name patterns (case-insensitive). A parent var whose
 * name matches any of these is dropped under `inherit-scrubbed`. Conservative
 * by design — see the EC-4 false-positive test. `[_-]PWD` (not bare `PWD`)
 * catches `DB_PWD` without dropping the shell's working-directory `PWD`.
 * `CREDENTIAL` catches `GOOGLE_APPLICATION_CREDENTIALS`. #54-a extends the list to
 * the highest-signal VALUE-embedded-secret conventions — connection strings that
 * carry `user:password@` (`DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`, `DB_URL`, …),
 * `DSN`, `WEBHOOK`, `COOKIE`, and `CONNECTION_STRING` — while deliberately NOT
 * dropping generic non-secret URLs (`PUBLIC_BASE_URL`, `API_URL`, `PGHOST`). A
 * denylist still cannot catch EVERY value-embedded secret — for untrusted children
 * use policy `"core"` (allowlist), the only fail-closed mode.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /PASSPHRASE/i,
  /[_-]PWD/i,
  /CREDENTIAL/i,
  /PRIVATE/i,
  /_AUTH/i,
  // #54-a — value-embedded-secret conventions (no generic `*_URL` — see keep-list test).
  /DSN/i,
  /WEBHOOK/i,
  /COOKIE/i,
  /CONNECTION[_-]?STRING/i,
  // Known DB / message-broker connection-string vars (carry `user:pass@`).
  /(?:^|[_-])(?:DATABASE|DB|REDIS|MONGO(?:DB)?|POSTGRES(?:QL)?|MYSQL|MARIADB|AMQP|RABBITMQ|CLICKHOUSE|ELASTIC(?:SEARCH)?|CASSANDRA|COUCHDB|MEMCACHED|NATS|KAFKA)[_-]?(?:URL|URI|DSN|CONNECTION)/i,
];

/**
 * Safe base variables kept under the `core` policy. Process-hygiene vars a
 * child almost always needs; none are secret-bearing.
 */
const CORE_VARS: readonly string[] = [
  "PATH",
  "HOME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
];

function isSecretName(name: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(name));
}

/** Whether a parent var of the given name is inherited under `policy`. */
function inheritsUnderPolicy(name: string, policy: EnvPolicy): boolean {
  if (policy === "all") return true;
  if (policy === "core") return CORE_VARS.includes(name);
  return !isSecretName(name); // inherit-scrubbed
}

export function resolveChildEnv(options: ResolveChildEnvOptions = {}): Record<string, string> {
  const parent = options.parent ?? process.env;
  const policy = options.policy ?? "inherit-scrubbed";

  const base: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && inheritsUnderPolicy(name, policy)) base[name] = value;
  }

  // Explicit overrides always win — even over a scrub.
  for (const [name, value] of Object.entries(options.overrides ?? {})) {
    base[name] = value;
  }
  return base;
}
