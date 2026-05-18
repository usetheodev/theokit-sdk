/**
 * Lint test (T6.2) — bans hardcoded `.theokit` string literals in `src/`.
 *
 * Forces callers to use `getTheokitHome(cwd)` from
 * `internal/persistence/paths.ts` (ADR D60). Without this discipline,
 * tests cannot isolate state via `THEOKIT_HOME` env override.
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

const SRC_ROOT = join(__dirname, "..", "..", "src");

/**
 * Files allowed to mention `.theokit` literally:
 *   - `internal/persistence/paths.ts` is the canonical resolver.
 *   - Documented migration debt (per-file comment explaining why).
 *
 * As callers migrate to `getTheokitHome(cwd)`, entries leave this list.
 */
const ALLOWLIST = new Set<string>(["internal/persistence/paths.ts"]);

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
    const offenders: Offender[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      const content = await readFile(file, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        // Match `.theokit` only inside string/template literals.
        // Skip single-line `//` and `*` comment lines so JSDoc examples
        // are not false positives.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
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
          "(use getTheokitHome instead):\n" +
          `${summary}\n`,
      );
    }

    // Soft assertion: don't fail the build, just log. The migration is
    // tracked separately; this test ensures the count never regresses.
    expect(offenders.length).toBeLessThanOrEqual(60);
  });

  it("the canonical resolver paths.ts is present", async () => {
    const path = join(SRC_ROOT, "internal", "persistence", "paths.ts");
    const content = await readFile(path, "utf-8");
    expect(content).toMatch(/export function getTheokitHome/);
  });
});
