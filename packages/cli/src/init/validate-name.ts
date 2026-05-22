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
 * Returns `true` if the name is valid for use as the `name` field in
 * `package.json` (npm-compatible).
 *
 * Pattern derived from npm's own `validate-npm-package-name` rules
 * (simplified — we cover the common 99% case, not every edge of npm's
 * legacy compat).
 */
const NPM_NAME_RE = /^(?:@[a-z0-9-][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/;

const RESERVED_NAMES = new Set(["node_modules", "favicon.ico", "..", "."]);

export interface NameValidation {
  ok: boolean;
  reason?: string;
}

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
