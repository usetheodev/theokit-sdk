/**
 * EC-A MUST FIX (edge-case review 2026-05-22): validate project name
 * against npm rules BEFORE any filesystem write. npm rejects:
 *   - uppercase letters
 *   - spaces / special chars other than `.`, `-`, `_`
 *   - leading dot / leading underscore (with exceptions)
 *   - scoped names without `@<scope>/<name>` shape
 *
 * Without this, the onboarding flow breaks on FIRST `pnpm install`
 * with a cryptic npm error — and the user can't tell whether it's a
 * CLI bug or their input.
 *
 * @internal
 */

/**
 * The shape an npm package name may take: an optional `@scope/` prefix, then a name starting with a
 * lowercase letter or digit and continuing with those plus `.`, `-`, `_`.
 *
 * Derived from npm's own `validate-npm-package-name` rules and deliberately simplified — it covers
 * the common case, not every corner of npm's legacy compatibility. It rejects uppercase, spaces and
 * a leading `.`/`_`/`-`; it does NOT check npm's core-module or URL-safety rules.
 */
const NPM_NAME_RE = /^(?:@[a-z0-9-][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/;

const RESERVED_NAMES = new Set(["node_modules", "favicon.ico", "..", "."]);

/** `reason` is present only when `ok` is false, and is written to be shown to the user verbatim. */
interface NameValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Check a project name against npm's rules BEFORE anything is written to disk (EC-A) — otherwise the
 * onboarding flow breaks on the user's first `pnpm install`, with an npm error that does not say
 * whether the CLI or the input was at fault.
 *
 * Never throws; a rejection is `{ ok: false, reason }`. Rejects an empty name, `node_modules`,
 * `favicon.ico`, `.`, `..`, anything over 214 characters, and anything the npm name pattern refuses.
 *
 * It validates the NAME, not the destination: a scoped name like `@scope/my-bot` passes here and
 * then scaffolds into a nested `@scope/my-bot/` directory.
 */
export function validateProjectName(name: string): NameValidation {
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, reason: "Project name is required." };
  }
  if (RESERVED_NAMES.has(name)) {
    return { ok: false, reason: `Name "${name}" is reserved.` };
  }
  if (name.length > 214) {
    return { ok: false, reason: "Project name must be ≤ 214 characters." };
  }
  if (!NPM_NAME_RE.test(name)) {
    return {
      ok: false,
      reason:
        "Invalid project name. Use lowercase letters, numbers, dashes, dots, or underscores. " +
        "Examples: `my-bot`, `@scope/my-bot`, `chat.bot`.",
    };
  }
  return { ok: true };
}
