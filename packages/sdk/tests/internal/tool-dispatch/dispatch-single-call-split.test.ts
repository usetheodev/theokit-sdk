/**
 * T10.4 — `dispatchSingleCall` split verification (PV#2).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 10 / T10.4.
 *
 * The plan calls for splitting the 158 LOC `dispatchSingleCall` orchestrator
 * (in `internal/agent-loop/tool-dispatch.ts`) into ≤ 8 sub-concerns so that
 * the existing `biome-ignore lint/complexity/noExcessiveCognitiveComplexity`
 * directive can be removed.
 *
 * Behavior preservation is asserted by the existing golden test suite
 * (`tests/golden/agent/custom-tools.golden.test.ts`) + hooks suite
 * (`tests/agent-tool-hooks.test.ts`). This structural assertion guards
 * against silent reintroduction of the directive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(): string {
  const path = resolve(__dirname, "../../../src/internal/agent-loop/tool-dispatch.ts");
  return readFileSync(path, "utf8");
}

/**
 * Pragmatic brace-matching scan: returns the body span (excluding the
 * surrounding braces) of the first function declaration whose signature
 * matches `needle`. Returns `undefined` when the declaration is not found
 * or the braces are unbalanced — caller asserts.
 */
function extractFunctionBody(src: string, needle: string): string | undefined {
  const idx = src.indexOf(needle);
  if (idx === -1) return undefined;
  const after = src.slice(idx);
  const span = scanBalancedBraces(after);
  return span === undefined ? undefined : after.slice(span.start, span.end);
}

function scanBalancedBraces(src: string): { start: number; end: number } | undefined {
  let depth = 0;
  let bodyStart = -1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") {
      if (bodyStart === -1) bodyStart = i + 1;
      depth++;
    } else if (src[i] === "}" && --depth === 0 && bodyStart !== -1) {
      return { start: bodyStart, end: i };
    }
  }
  return undefined;
}

function nonBlankNonCommentLoc(body: string): number {
  return body.split("\n").filter((l) => l.trim().length > 0 && !l.trim().startsWith("//")).length;
}

describe("Architecture — T10.4 dispatchSingleCall split (PV#2)", () => {
  it("file no longer suppresses noExcessiveCognitiveComplexity for the orchestrator", () => {
    const src = readSource();
    const matches = src.match(/biome-ignore[^\n]*noExcessiveCognitiveComplexity/g) ?? [];
    expect(
      matches,
      `Expected zero biome-ignore for noExcessiveCognitiveComplexity in tool-dispatch.ts after T10.4 split. Found:\n${matches.join("\n")}`,
    ).toEqual([]);
  });

  it("orchestrator function body is ≤ 50 LOC (down from 158)", () => {
    const body = extractFunctionBody(readSource(), "async function dispatchSingleCall(");
    expect(body, "dispatchSingleCall body not extractable").toBeDefined();
    const loc = nonBlankNonCommentLoc(body ?? "");
    expect(
      loc,
      `Expected dispatchSingleCall body ≤ 50 LOC (non-blank, non-comment) after split. Got: ${loc}`,
    ).toBeLessThanOrEqual(50);
  });
});
