/**
 * Path resolution for SDK state files (ADR D60).
 *
 * Theokit anchors state at `<cwd>/.theokit/` by default (per-cwd). An
 * optional `THEOKIT_HOME` environment variable overrides this, enabling
 * test isolation, profile switching, and multi-tenant deployments.
 *
 * Rules:
 *   - `getTheokitHome(cwd)` is the canonical resolver **for cwd-anchored state**. Never hardcode
 *     `path.join(cwd, ".theokit")` in callers — use this function so tests
 *     and overrides stay consistent.
 *
 *     M94 — this comment said "the ONLY canonical resolver", and stopped being true: the
 *     transcript gained `transcriptRoot()`, which is **home-anchored** (`~/.theokit`) with the same
 *     `THEOKIT_HOME` override. The two defaults differ on purpose — unifying would move the
 *     transcript of everyone who does NOT set the variable, which is a data migration and not a
 *     re-export.
 *
 *     A consequence worth writing down: **without `THEOKIT_HOME` the state stays split in two**
 *     — registry in `<cwd>/.theokit`, transcript in `~/.theokit`. M94 unifies only for those who set
 *     the variable. Unifying both defaults is another milestone's work.
 *   - `getProfilesRoot()` is intentionally home-anchored (not affected by
 *     `THEOKIT_HOME`) so `theokit profile list` discovers all profiles
 *     regardless of which is active.
 *   - `displayTheokitHome(cwd)` returns a human-readable path for logs.
 *
 * @internal
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { CLAUDE_DIR_NAME, THEOKIT_DIR_LITERAL } from "../runtime/compat/foreign-config-sources.js";

// The directory names live with the dialect registry that owns them — a name is one third of what a
// configuration dialect is, and keeping the three together is what stops the next one shipping
// without its runtime contract (#522).

/**
 * Resolve the directory cwd-anchored SDK state lives in.
 *
 * `THEOKIT_HOME` wins when it is set and not blank after trimming; the trimmed value is used, and
 * it is used VERBATIM — it is not resolved against `cwd`, so a relative value stays relative and
 * `.theokit` is not appended to it. Otherwise the answer is `<cwd>/.theokit`.
 *
 * The environment is read on every call, so a change to the variable takes effect immediately
 * rather than being frozen at import.
 *
 * This creates nothing and checks nothing: the returned path may not exist, and the caller owns
 * the `mkdir`. Call it instead of writing `join(cwd, ".theokit")` by hand, or the override stops
 * working for that one call site and tests silently touch the real home.
 *
 * Not the whole story about where state lives — the transcript is home-anchored via
 * `transcriptRoot()`, honoring the same variable but defaulting to `~/.theokit`. With
 * `THEOKIT_HOME` unset, state is genuinely split between two roots.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export function getTheokitHome(cwd: string): string {
  const override = process.env.THEOKIT_HOME?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return join(cwd, THEOKIT_DIR_LITERAL);
}

/**
 * Every directory a project's configuration may be read from, in precedence order.
 *
 * `.theokit` first, then `.claude`. The order is the whole contract: a project that declares a
 * skill, agent or rule in both means the explicit namespace to win, and a caller merging these
 * roots must therefore keep the FIRST occurrence of a name rather than the last.
 *
 * `.claude` is read because the formats already agree and only the location did not. Measured
 * 2026-08-26: the SKILL.md frontmatter this SDK requires (`name` + `description`) is exactly what
 * the CLI writes, its hook config is the same JSON shape, and 59 of the CLI's agent declarations
 * parse here unchanged. A repository set up for the CLI was failing on the directory name alone.
 *
 * NOT a rename of `.theokit`, and not a migration. Both are read, so nothing that works today stops
 * working — which is why this returns a LIST and not a single resolved answer.
 *
 * Deliberately NOT affected by `THEOKIT_HOME`, and this is the one thing to remember about it.
 * That variable relocates cwd-anchored SDK *state* — sessions, the credential store. A project's
 * *configuration* is a property of the repository, not of where this SDK keeps its state, and the
 * loaders that read these directories have always anchored on `cwd` directly. Honouring the
 * override here would silently move where a project's agents and skills come from, which is a
 * behaviour change wearing the costume of a refactor.
 *
 * Creates nothing and checks nothing; either path may not exist, and the caller owns that.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export function projectConfigRoots(cwd: string): string[] {
  return [join(cwd, THEOKIT_DIR_LITERAL), join(cwd, CLAUDE_DIR_NAME)];
}

/**
 * Every directory that may hold a plugin BUNDLE contributed by the Claude Code CLI.
 *
 * A CLI plugin is not a JS entry point — it is a folder whose `skills/` and `agents/` are what it
 * exists to provide. Measured 2026-08-26 on an installed one: seven agents and three skills beside
 * a manifest in `.claude-plugin/plugin.json`. Parsing that manifest and stopping there produced a
 * plugin that loaded and did nothing.
 *
 * Project-scoped deliberately. The CLI also keeps plugins under `~/.claude/plugins/cache`, behind
 * its own installer and enable/disable state — reproducing that is an installation system, not
 * reading a project's configuration, and guessing at someone's enablement would run code they
 * turned off.
 */
export function pluginBundleRoots(cwd: string): string[] {
  return projectConfigRoots(cwd).map((root) => join(root, "plugins"));
}

/**
 * The directory holding every profile: always `~/.theokit/profiles`, from `os.homedir()`.
 *
 * Deliberately NOT affected by `THEOKIT_HOME`, which is the one thing to remember about it. If it
 * followed the override, a session pointed at one profile would only be able to see that profile,
 * and `theokit profile list` could never enumerate the rest. Profiles are the thing the override
 * switches between, so their index cannot live behind it.
 *
 * Takes no `cwd` for the same reason. Creates nothing; the path may not exist.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export function getProfilesRoot(): string {
  return join(homedir(), THEOKIT_DIR_LITERAL, "profiles");
}

/**
 * The same path `getTheokitHome(cwd)` returns, shortened for display: the home directory prefix
 * collapses to `~`, so `/home/ada/.theokit` prints as `~/.theokit`.
 *
 * For humans only — log lines, CLI output, error messages. The result is NOT a usable path: `~`
 * is a shell convention that `fs` does not expand, so passing this to a filesystem call resolves
 * a literal directory named `~` relative to the process cwd. Use `getTheokitHome` for anything
 * that touches disk.
 *
 * Collapsing is a prefix match on the home directory followed by a literal `/`, so a sibling like
 * `/home/adalovelace` is left alone even though `/home/ada` is a string prefix of it. A path
 * outside the home directory comes back unchanged — and so does a Windows path, where the
 * separator is a backslash and the prefix test therefore never matches.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export function displayTheokitHome(cwd: string): string {
  const resolved = getTheokitHome(cwd);
  const home = homedir();
  if (resolved === home) return "~";
  if (resolved.startsWith(`${home}/`)) {
    return `~${resolved.slice(home.length)}`;
  }
  return resolved;
}
