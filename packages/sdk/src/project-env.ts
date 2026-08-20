/**
 * Load a project's `.env` without letting it move the credential store or switch off a trust
 * decision.
 *
 * `process.loadEnvFile()` reads the PROJECT's `.env` into `process.env`. For a provider key that is
 * exactly right and is the documented way to configure a scaffolded product. For the handful of
 * variables that decide WHERE credentials live and WHAT is trusted it is a hole: a cloned
 * repository is untrusted input, and a `.env` inside it is untrusted input the runtime is about to
 * treat as configuration.
 *
 * Concretely, without this guard a repository shipping
 *
 * ```
 * THEOKIT_AUTH_HOME=/tmp/attacker-store
 * ```
 *
 * redirects the credential store the moment the product starts in that directory — before any
 * trust prompt, because locating the store is what happens first.
 *
 * ## Why it lives here
 *
 * The scaffolding template (`create-theokit`, TUI surface) calls `process.loadEnvFile()` with no
 * guard, so every product generated from it starts exposed. One consumer found this and fixed it in
 * ~30 lines of its own. A defence each consumer has to rediscover is a defence most will not have,
 * and this one is invisible when missing: nothing fails, the store simply moves.
 *
 * ## Why the set is named
 *
 * A convention — "anything ending in `_HOME`", "anything with TRUST in it" — silently changes
 * meaning as variables are added, in the direction of accidentally sovereign or accidentally not.
 * The list is explicit so that making a variable sovereign is a deliberate act, and so a reader can
 * see the security boundary without grepping for it.
 *
 * @public
 */

/**
 * Variables a project-scoped source may never set. Each either locates the credential store, names
 * the config directory that is read as configuration, or carries a trust decision.
 *
 * `THEOKIT_API_KEY` is deliberately ABSENT. A project supplying its own provider key through `.env`
 * is the documented, intended path — treating it as sovereign would break every scaffolded product
 * to defend nothing, since a key the project supplies is a key the project already has.
 *
 * @public
 */
export const SOVEREIGN_ENV_KEYS = [
  /** Locates the SDK home — sessions, and the credential store beneath it. */
  "THEOKIT_HOME",
  /** Locates the credential store explicitly, independently of `THEOKIT_HOME`. */
  "THEOKIT_AUTH_HOME",
  /** Names the project config directory, so it decides which files are READ as configuration. */
  "THEOKIT_DIR_NAME",
  /** A trust decision: which providers are honoured without further checks. */
  "THEOKIT_TRUSTED_PROVIDERS",
  /** Turning redaction off from a repository's `.env` would put secrets into logs. */
  "THEOKIT_REDACT_SECRETS",
  /** Cryptographic material for the OAuth transaction cookie. */
  "THEOKIT_OAUTH_TX_SALT",
] as const;

/**
 * The union of {@link SOVEREIGN_ENV_KEYS} entries — the variables a project-scoped `.env` may never
 * set.
 *
 * Derived from the array rather than written out, so adding a key in one place cannot leave the
 * type behind. Use it where a caller must name one of the protected variables and a plain `string`
 * would let a typo through silently.
 *
 * @public
 */
export type SovereignEnvKey = (typeof SOVEREIGN_ENV_KEYS)[number];

/** The mutable shape of `process.env`, narrowed so a caller can pass a plain object in tests. */
type MutableEnv = Record<string, string | undefined>;

/**
 * Read the project's `.env` into `env`, then restore every {@link SOVEREIGN_ENV_KEYS} entry to the
 * value it had BEFORE the load — including restoring it to absent.
 *
 * Capture-then-restore rather than filtering the file: `process.loadEnvFile` offers no hook between
 * parsing and assignment, and reimplementing dotenv parsing to filter it would be a second parser
 * to keep in step with Node's. Restoring afterwards needs no parser and cannot disagree with one.
 *
 * @param env the environment to mutate. Defaults to `process.env`.
 * @param load performs the load. Defaults to `process.loadEnvFile` when the runtime has it, and to
 *   `undefined` when it does not — in which case this is a no-op rather than a startup crash.
 * @public
 */
export function loadProjectEnv(
  env: MutableEnv = process.env,
  load: (() => void) | undefined = typeof process.loadEnvFile === "function"
    ? (): void => {
        process.loadEnvFile();
      }
    : undefined,
): void {
  if (load === undefined) return;

  // Captured BEFORE the load, including the absent case — `undefined` here means "was not set",
  // and restoring that means deleting the key rather than leaving the project's value in place.
  const sovereign = new Map<string, string | undefined>(
    SOVEREIGN_ENV_KEYS.map((key) => [key, env[key]] as const),
  );

  try {
    load();
  } catch {
    // No `.env` on disk is the ordinary case and `loadEnvFile` throws for it. Nothing was assigned,
    // so there is nothing to restore.
    return;
  }

  for (const [key, original] of sovereign) {
    if (original === undefined) delete env[key];
    else env[key] = original;
  }
}
