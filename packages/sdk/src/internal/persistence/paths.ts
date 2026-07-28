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
 *     M94 — este comentário dizia "the ONLY canonical resolver", e deixou de ser verdade: o
 *     transcript ganhou `transcriptRoot()`, que é **home-ancorado** (`~/.theokit`) com o mesmo
 *     override por `THEOKIT_HOME`. Os dois defaults diferem de propósito — unificar moveria o
 *     transcript de todo mundo que NÃO define a variável, que é uma migração de dados e não um
 *     re-export.
 *
 *     Consequência que merece estar escrita: **sem `THEOKIT_HOME` o estado segue partido em dois**
 *     — registry em `<cwd>/.theokit`, transcript em `~/.theokit`. O M94 unifica só para quem define
 *     a variável. Unificar os dois defaults é trabalho de outro milestone.
 *   - `getProfilesRoot()` is intentionally home-anchored (not affected by
 *     `THEOKIT_HOME`) so `theokit profile list` discovers all profiles
 *     regardless of which is active.
 *   - `displayTheokitHome(cwd)` returns a human-readable path for logs.
 *
 * @internal
 */

import { homedir } from "node:os";
import { join } from "node:path";

const THEOKIT_DIR_NAME = ".theokit";

/**
 * Resolve the active Theokit state directory.
 *
 * Returns the value of `THEOKIT_HOME` env var if set (and non-empty after
 * trim); otherwise returns `<cwd>/.theokit`.
 *
 * @internal
 */
export function getTheokitHome(cwd: string): string {
  const override = process.env.THEOKIT_HOME?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return join(cwd, THEOKIT_DIR_NAME);
}

/**
 * Profiles root is ALWAYS at `~/.theokit/profiles/`, regardless of
 * `THEOKIT_HOME`. This lets `theokit profile list` see all profiles
 * regardless of which one is currently active.
 *
 * @internal
 */
export function getProfilesRoot(): string {
  return join(homedir(), THEOKIT_DIR_NAME, "profiles");
}

/**
 * Human-readable Theokit home for log/print output. Collapses `$HOME` to
 * `~` when applicable. NEVER used for `fs.*` calls — use `getTheokitHome`
 * for those.
 *
 * @internal
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
