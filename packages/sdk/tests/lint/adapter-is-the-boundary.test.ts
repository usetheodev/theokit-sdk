import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MEMORY_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "internal",
  "memory",
);

/**
 * An adapter exists to BE the boundary. `LanceMemoryAdapter` used to carry
 * `unwrap(): LanceIndex`, handing callers the raw adaptee for the three
 * capabilities the port does not expose (addFacts / countFacts / removeFacts).
 * Measured 2026-09-01, it had zero callers monorepo-wide — including the
 * "migration tool, benchmark script" its own docblock named, both of which
 * hold a `LanceIndex` directly. What it did have was `status()`'s comment
 * pointing at it, which made the leak read as the supported workaround.
 *
 * This gate keeps the boundary closed. It strips comments before matching,
 * and asserts that the stripping removed something — the first version did
 * not, and tripped on the very comment that explains the removal, which would
 * have taught the next reader to delete the explanation rather than the leak.
 */
describe("the memory adapter is the boundary", () => {
  const source = readFileSync(join(MEMORY_ROOT, "lance-memory-adapter.ts"), "utf8");
  const classBody = source.slice(source.indexOf("export class LanceMemoryAdapter"));
  /** Comments name the removed method on purpose; only code may satisfy or trip the checks. */
  const code = classBody.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("reads a class body, and strips comments from it, before asserting anything", () => {
    expect(classBody).toContain("implements MemoryIndex");
    expect(classBody.length).toBeGreaterThan(400);
    // Both halves matter: an empty slice passes every check below, and an
    // unstripped one fails them for the wrong reason.
    expect(code.length).toBeGreaterThan(300);
    expect(
      classBody.length - code.length,
      "no comment was stripped — the regex stopped matching",
    ).toBeGreaterThan(200);
  });

  it("declares no method outside the MemoryIndex port", () => {
    const declared = [...code.matchAll(/^ {2}(?:async )?([a-z][A-Za-z0-9]*)\(/gm)].map(
      (m) => m[1] ?? "",
    );
    expect(
      declared.length,
      "the method scan found nothing — it stopped matching",
    ).toBeGreaterThanOrEqual(4);
    expect(
      declared.filter((m) => !["constructor", "sync", "search", "status", "close"].includes(m)),
      "a method beyond sync/search/status/close is the adapter handing out something " +
        "the port does not promise — which is how `unwrap()` made the adaptee reachable",
    ).toEqual([]);
  });

  it("never returns the adaptee type from a member", () => {
    expect(
      /\)\s*:\s*LanceIndex\b/.test(code),
      "a member returning LanceIndex is the adaptee escaping through the adapter",
    ).toBe(false);
  });
});
