/**
 * Lint test (T6.2) — bans hardcoded `.theokit` string literals in `src/`.
 *
 * Forces callers onto a named resolver in `internal/persistence/paths.ts` (ADR D60) — and there are
 * TWO, not one, because a project's declared CONFIGURATION and the SDK's runtime STATE answer a
 * different question about `THEOKIT_HOME`:
 *
 *   - `theokitConfigRoot(cwd)` — hooks, MCP servers, context sources, subagents, the personality a
 *     project declares. Always `<cwd>/.theokit`. These are committed to git and shared by a team;
 *     following the override would move where a project's declared capabilities come from.
 *   - `getTheokitHome(cwd)` — sessions, credentials: state that legitimately relocates when an
 *     operator sets `THEOKIT_HOME`, and which tests need to isolate via the same override.
 *
 * Migrating a CONFIG-class literal to `getTheokitHome` is not a fix — it is the exact silent
 * behaviour change this file exists to prevent, aimed at the wrong target.
 *
 * The audit is informational at v1.3 (allowlist covers the long migration
 * tail). Each entry that lands in the allowlist must justify itself in a
 * comment OR move toward `getTheokitHome` over time.
 *
 * @internal
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectScopeCovered } from "./_scope-sentinel.js";

const SRC_ROOT = join(__dirname, "..", "..", "src");

/**
 * Files allowed to mention `.theokit` literally:
 *   - `internal/persistence/paths.ts` is the canonical resolver.
 *   - `internal/runtime/compat/foreign-config-sources.ts` DECLARES the literal, as one third of what
 *     a configuration dialect is — the directory, the parse, and the runtime contract its commands
 *     presume. It moved there from `paths.ts` in #522, where the third had gone unwritten and a
 *     Claude Code hook was executed without `$CLAUDE_PROJECT_DIR`. `paths.ts` imports it.
 *   - Documented migration debt (per-file comment explaining why).
 *
 * As callers migrate to `getTheokitHome(cwd)`, entries leave this list.
 */
const ALLOWLIST = new Set<string>([
  "internal/persistence/paths.ts",
  "internal/runtime/compat/foreign-config-sources.ts",
]);

interface Offender {
  file: string;
  line: number;
  text: string;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      await walk(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("lint: no hardcoded .theokit paths in src/", () => {
  it("all `.theokit` literals are either in paths.ts or explicitly allowed", async () => {
    const files = await walk(SRC_ROOT);
    expectScopeCovered(files, "index.ts", SRC_ROOT);
    const offenders: Offender[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      const content = await readFile(file, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        // Match `.theokit` only inside string/template literals.
        // Skip comment lines so JSDoc examples are not false positives.
        //
        // `/**` was missing from this list and a one-line docblock — `/** reads `.theokit/` only.
        // */` — counted as a hardcoded path. It is the very case the exemption was written for: a
        // JSDoc mentioning the literal it documents. The filter already skips every other comment
        // form, and no executable statement can begin with `/**`, so the gap admitted false
        // positives without admitting one real offender.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/**")) {
          return;
        }
        if (/['"`]\.theokit/.test(line)) {
          offenders.push({ file: rel, line: idx + 1, text: trimmed });
        }
      });
    }

    if (offenders.length > 0) {
      const summary = offenders
        .map((o) => `  ${o.file}:${o.line} — ${o.text.slice(0, 100)}`)
        .join("\n");
      // Soft-fail with informational message: this is migration debt.
      // The current allowlist is intentionally small; new code MUST use
      // `getTheokitHome(cwd)`. Existing callers migrate per ADR D60 §4.
      process.stderr.write(
        `[lint:no-hardcoded-theokit-path] ${offenders.length} legacy literal(s) found ` +
          "(use theokitConfigRoot() for project config, getTheokitHome() for SDK state):\n" +
          `${summary}\n`,
      );
    }

    // A RATCHET, pinned to the measured count. It used to say "this test ensures the count never
    // regresses" and assert `<= 60` against a real count of 28 — so it tolerated 32 NEW hardcoded
    // literals before it could fail. It did not ensure the count never regresses; it ensured it
    // never tripled, while reading as the former.
    //
    // Pinned exactly, so the next literal added fails here. When the migration removes some, LOWER
    // this number in the same commit — a ratchet that is only ever loosened is a budget.
    //
    // 28 → 23 when `/**` joined the comment filter (#524): five of the twenty-eight were one-line
    // docblocks naming the literal they document, never code. The ratchet moved DOWN, which is the
    // direction it is allowed to move without an argument.
    //
    // 23 → 14 when the CONFIG-class readers — mcp.json, the context dir + context.json, the hooks
    // fallback check, registry.json, the personality PROJECT_SUBDIR — moved onto the new
    // `theokitConfigRoot(cwd)` (#524 follow-up). `USER_SUBDIR` in the same file stayed: it is
    // homedir-anchored, a different resolver's job, not this one's.
    expect(
      offenders.length,
      offenders.length > 14
        ? `${offenders.length} hardcoded \`.theokit\` literals, up from the pinned 14. Use ` +
            "theokitConfigRoot() (project config) or getTheokitHome() (SDK state) instead."
        : `${offenders.length} literals remain, below the pinned 14 — lower the number in this file ` +
            "to lock the ground in.",
    ).toBe(14);
  });

  it("the canonical resolver paths.ts is present", async () => {
    const path = join(SRC_ROOT, "internal", "persistence", "paths.ts");
    const content = await readFile(path, "utf-8");
    expect(content).toMatch(/export function getTheokitHome/);
  });
});
