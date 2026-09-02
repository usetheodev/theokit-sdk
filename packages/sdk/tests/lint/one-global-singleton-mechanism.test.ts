/**
 * Process-global state goes through `globalSingleton`, not through a hand-rolled `globalThis` cast.
 *
 * The helper exists because a package can be loaded twice in one process — two copies in
 * `node_modules`, ESM and CJS side by side, a monorepo with distinct versions — and then a
 * module-level `const x = new Map()` produces two caches that cannot see each other. `Symbol.for` uses
 * the global symbol registry, which belongs to the realm rather than the module, so every copy
 * converges.
 *
 * Its docblock claimed the duplication was over. Five sites still hand-rolled the same six lines, and
 * two of them shared ONE key across two files — `compact-session.ts` created the Map and
 * `agent-session.ts` cleared it, each with its own cast. The behavioural risk is the one the helper
 * states: if the mechanism ever needs to change — a different key namespace, a `WeakRef`, a
 * cross-realm fallback — the sites that import it move and the copies do not.
 *
 * WHAT THIS GATE CANNOT SEE, stated because a gate believed to be complete is worse than a narrow
 * one. It matches the hand-rolled CAST. It does not and cannot tell which module-level `const cache =
 * new Map()` ought to be realm-global: most of them are legitimately module-local, and deciding is a
 * judgement about whether two copies of the package would need to agree. Three that did need it —
 * `liveAgentRegistry` and session-cache's two maps — were found by reading, not by this. The
 * session-cache pair even carried a docblock asserting that "an ES module is a singleton", which is
 * the sentence `internal/global-singleton.ts` exists to refute.
 *
 * DELIBERATELY NOT COVERED: a settable SLOT is a different pattern and keeps its own symbol.
 * `diagnostics.ts`'s sink and `agent-factory-registry.ts`'s facade are written, replaced and cleared
 * by their owners; `globalSingleton` is create-once-and-return, which cannot express that. Folding
 * them in would mean pretending two mechanisms are one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");
/** The cast that reaches for a create-once global by hand. */
const HAND_ROLLED = /globalThis as unknown as Record<\s*symbol\s*,/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("global singleton mechanism", () => {
  it("scans a tree that contains the helper it is policing", () => {
    const files = walk(SRC_ROOT).map((f) => relative(SRC_ROOT, f));
    expect(files.length).toBeGreaterThan(100);
    expect(files, "the helper must be in scope, or this gate reads the wrong tree").toContain(
      join("internal", "global-singleton.ts"),
    );
  });

  it("no file hand-rolls a create-once globalThis map", () => {
    const offenders = walk(SRC_ROOT)
      .filter((file) => !file.endsWith(join("internal", "global-singleton.ts")))
      .filter((file) => HAND_ROLLED.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_ROOT, file));

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These reach for process-global state by hand instead of through globalSingleton():\n` +
            `${offenders.map((o) => `  src/${o}`).join("\n")}\n` +
            `Use globalSingleton("<key>", () => <initial>). A settable SLOT is a different pattern and ` +
            `is not what this forbids — see this file's docblock.`,
    ).toEqual([]);
  });
});
