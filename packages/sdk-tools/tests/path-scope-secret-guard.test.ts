/**
 * M76 review (H1) — the per-segment secret guard, tested DIRECTLY.
 *
 * ## Why this file exists
 *
 * Mutation review proved 3 of the 4 decision branches had no oracle. Reducing
 * `SENSITIVE_SEGMENTS` to `{".env"}` — letting `.git`, `node_modules` and `.theo` through —, inverting
 * the `.env.example` exception, or removing the regex `/^\.env\./` (which catches `.env.production`), **passed
 * with the whole suite green**. Only the literal `.env` was covered, and by accident: through a test of
 * `list-dir` that exercised a path with that segment.
 *
 * The guard is `allowAbsolute`'s non-negotiable half: `isForbiddenPath` only blocks the sensitive item
 * when it is the FIRST segment, so a `/home/u/proj/.env/sub` would pass. Testing it only
 * indirectly, through a tool, is what let 3 branches go unproven.
 *
 * ## On top of that, it had TWO copies
 *
 * M76's "promotion" moved the guard into `path-scope.ts` but left the private copy in
 * `read-file.ts` — creating exactly the duplication the promoted docblock said it existed to
 * avoid. Now there is only one, and this file is its oracle.
 */
import { describe, expect, it } from "vitest";

import { isForbiddenAtAnyDepth } from "../src/path-scope.js";

describe("M76 review — secret guard on any segment", () => {
  it("test_it_blocks_each_sensitive_segment_at_depth", () => {
    // The branch the "reduce the list to {.env}" mutation broke without anything noticing.
    for (const seg of [".env", ".git", "node_modules", ".theo"]) {
      expect(
        isForbiddenAtAnyDepth(`/home/u/proj/${seg}/sub/x`),
        `"${seg}" in an intermediate segment must block`,
      ).toBe(true);
    }
  });

  it("test_it_blocks_env_variants_such_as_env_production", () => {
    // The `/^\.env\./` regex branch. Without it, `.env.production` — which carries production secrets —
    // would pass, while `.env` blocks. The worst failure mode: partial and plausible.
    for (const seg of [".env.production", ".env.local", ".env.staging"]) {
      expect(isForbiddenAtAnyDepth(`/a/${seg}/b`), `"${seg}" must block`).toBe(true);
    }
  });

  it("test_env_example_is_the_EXCEPTION_and_stays_allowed", () => {
    // The exception branch. `.env.example` is a versioned template — blocking it would be a false positive, and
    // a false positive here teaches the user to turn the guard off.
    expect(isForbiddenAtAnyDepth("/a/.env.example/b")).toBe(false);
    expect(isForbiddenAtAnyDepth("/a/.env.example")).toBe(false);
  });

  it("test_a_clean_path_does_NOT_block", () => {
    // COUNTER-PROOF: without it, an implementation always returning `true` would pass everything above.
    expect(isForbiddenAtAnyDepth("/home/u/proj/src/lib")).toBe(false);
    expect(isForbiddenAtAnyDepth("/usr/share/doc")).toBe(false);
  });

  it("test_the_windows_separator_is_analyzed_too", () => {
    // The guard's `replace(/\\/g, "/")`. Without it, a backslash path would escape entirely.
    expect(isForbiddenAtAnyDepth("C:\\proj\\.git\\config")).toBe(true);
  });
});
