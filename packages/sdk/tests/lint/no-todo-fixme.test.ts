/**
 * Lint test — bans TODO / FIXME / XXX / HACK markers in `packages/sdk/src/`
 * (S3 in quality-gates.md, promoted from manual grep to automated gate
 * 2026-05-19).
 *
 * Per `.claude/rules/no-stubs-no-mocks-no-wired.md` (inviolable rule),
 * production code that reaches the public API MUST be implemented
 * end-to-end. TODO/FIXME markers are usually the residue of:
 *
 * - Stubbed features that throw `not_implemented` (forbidden, rule 1)
 * - Deferred work without a tracking issue (degrades into bit rot)
 * - Hot-fix hacks that the author intended to clean up but didn't
 *
 * Comments that EXPLAIN past tradeoffs (e.g. "we picked SQLite over X
 * because Y") are fine — those don't carry a TODO/FIXME prefix.
 *
 * Allowlist semantics: every entry needs a justification comment near
 * the marker and a tracking issue. Currently empty — production carries
 * no markers, the path stays clean.
 *
 * @internal
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

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

// Match the marker only when it's a comment token (not e.g. a string literal
// inside a regex test fixture). Look for whitespace or `//` / `/*` before it
// AND a `:`/` ` after it — the conventional "// TODO: ..." form.
const PATTERN = /(^|[\s/*])(TODO|FIXME|XXX|HACK)(:|\s)/;

async function scanFile(file: string): Promise<Offender[]> {
  const rel = relative(SRC_ROOT, file);
  if (ALLOWLIST.has(rel)) return [];
  // Skip this lint file itself — the regex literal would self-trigger if it
  // were in `src/`. We restrict the walk to `src/` already, so this is
  // defensive only.
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

describe("no TODO / FIXME / XXX / HACK markers in src (S3)", () => {
  it("packages/sdk/src/ has no production stub markers", async () => {
    const files = await walk(SRC_ROOT);
    const offenders: Offender[] = [];
    for (const file of files) {
      offenders.push(...(await scanFile(file)));
    }
    expect(offenders).toEqual([]);
  });
});
