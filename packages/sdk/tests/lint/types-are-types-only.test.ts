import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/types/index.ts` opens with "Type contract for @theokit/sdk. These exported types are the
 * canonical public contract" and re-exports every sibling with `export type *`.
 * `.dependency-cruiser.cjs` restates it as a gate comment: "src/types/* are pure type definitions."
 *
 * Both were prose. Three files carried runtime code anyway — `types/task.ts` (the task-id grammar),
 * `types/run-events.ts` (`emitRunEvent`) and `types/workflow.ts` (twelve error classes) — and the
 * first of them shipped a defect: `export type *` cannot carry a VALUE, so `isValidTaskId` reached
 * consumers only through the DTS rollup hoisting a declaration the runtime bundle never emitted.
 * `import { isValidTaskId } from "@theokit/sdk"` typechecked and was `undefined` at the call site
 * (#279), and the fix at the time was a second explicit export from `index.ts` rather than moving
 * the function out of the barrel that cannot carry it.
 *
 * This is the gate the comment was standing in for. A type file exports types.
 *
 * What it CANNOT check: whether the module a value moved to is the RIGHT one. It only refuses the
 * one home that is provably wrong.
 */
const TYPES_DIR = join(import.meta.dirname, "..", "..", "src", "types");

/** A line that introduces a runtime binding into the module's export surface. */
const VALUE_EXPORT =
  /^export\s+(?:default\b|async\s+function\b|function\b|const\b|let\b|var\b|class\b|(?!type\b)enum\b)/;

function valueExportsIn(file: string): string[] {
  const body = readFileSync(join(TYPES_DIR, file), "utf8");
  return body
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => VALUE_EXPORT.test(line))
    .map(({ line, n }) => `${file}:${n} — ${line.trim().slice(0, 72)}`);
}

describe("src/types/ holds types and nothing else", () => {
  const files = readdirSync(TYPES_DIR).filter((f) => f.endsWith(".ts"));

  it("has files to check — a sweep over an empty directory proves nothing", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("exports no runtime value from any type module", () => {
    const offenders = files.flatMap(valueExportsIn);
    expect(
      offenders,
      "A value exported from src/types/ cannot reach a consumer through the `export type *` barrel " +
        "in types/index.ts. It reaches them through the DTS rollup and NOT through the runtime " +
        "bundle — a declaration with nothing behind it. Move it to a runtime module (see " +
        "src/workflow-errors.ts, src/internal/task/task-id.ts, src/internal/emit-run-event.ts) and " +
        "re-export it by name from the public entry point.",
    ).toEqual([]);
  });

  it("keeps `export type` and `export interface` — the rule is about values, not about exporting", () => {
    const decls = files.flatMap((f) =>
      readFileSync(join(TYPES_DIR, f), "utf8")
        .split("\n")
        .filter((l) => /^export\s+(type|interface)\b/.test(l)),
    );
    expect(decls.length).toBeGreaterThan(100);
  });
});
