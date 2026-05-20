/**
 * Lint test — bans snapshot tests in the SDK suite (testing-invariant-vs-snapshot
 * pattern, promoted CULTURAL → DONE 2026-05-19).
 *
 * Snapshot tests (`toMatchSnapshot`, `toMatchInlineSnapshot`) couple
 * assertions to byte-identical output instead of invariants:
 *
 * - Refactors that change formatting/whitespace/key order break snapshots
 *   even when behaviour is identical.
 * - Failure messages show the diff, not the WHY — debugging takes longer.
 * - Snapshots accumulate as test debt; nobody re-reads them, so they
 *   become rubber-stamp updates that lose signal.
 *
 * For SDK code (no UI rendering, no formatter output) invariant assertions
 * (`expect(x.field).toBe(...)`, `expect(arr).toHaveLength(...)`,
 * `expect(...).toMatchObject({...})`) are always strictly better.
 *
 * If a future case TRULY requires a snapshot (e.g., canonical JSON contract
 * fixtures), add the file to ALLOWLIST with a one-line justification and
 * keep the snapshot under `tests/fixtures/`.
 *
 * @internal
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const TESTS_ROOT = join(__dirname, "..", "..", "tests");

/**
 * Test files allowed to call snapshot APIs. Each entry must justify itself
 * in a comment near the snapshot call. Empty for now — no legitimate use
 * has surfaced.
 */
const ALLOWLIST = new Set<string>([]);

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
    if (s.isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// Matches both `toMatchSnapshot()` and `toMatchInlineSnapshot()` — plus
// `toMatchFileSnapshot` for completeness with the Vitest snapshot family.
const PATTERN = /\.toMatch(File)?(Inline)?Snapshot\s*\(/;

async function scanFile(file: string): Promise<Offender[]> {
  const rel = relative(TESTS_ROOT, file);
  if (ALLOWLIST.has(rel)) return [];
  // Skip this lint file itself — the regex literal would self-trigger.
  if (rel === "lint/no-snapshot-tests.test.ts") return [];
  const text = await readFile(file, "utf8");
  const offenders: Offender[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && PATTERN.test(line)) {
      offenders.push({ file: rel, line: i + 1, text: line.trim() });
    }
  }
  return offenders;
}

describe("no snapshot tests (testing-invariant-vs-snapshot)", () => {
  it("packages/sdk/tests/ has no toMatchSnapshot / toMatchInlineSnapshot calls", async () => {
    const files = await walk(TESTS_ROOT);
    const offenders: Offender[] = [];
    for (const file of files) {
      offenders.push(...(await scanFile(file)));
    }
    expect(offenders).toEqual([]);
  });
});
