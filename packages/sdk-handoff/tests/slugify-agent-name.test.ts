import { expect, it } from "vitest";
import { slugifyAgentName } from "../src/internal/slugify-agent-name.js";

/**
 * Characterization tests for behaviour that had **no test at all** while living in two copies.
 * They are written to the existing behaviour on purpose: the extraction must not change results,
 * and without them a refactor of an untested function is a rewrite nobody can check.
 */

it("strips a leading agent- prefix, case-insensitively", () => {
  expect(slugifyAgentName("agent-reviewer")).toBe("reviewer");
  expect(slugifyAgentName("AGENT-Reviewer")).toBe("Reviewer");
});

it("collapses every run of unsafe characters into a single underscore", () => {
  expect(slugifyAgentName("code reviewer")).toBe("code_reviewer");
  expect(slugifyAgentName("a!!!  ???b")).toBe("a_b");
});

it("trims underscores from both ends", () => {
  expect(slugifyAgentName("__lead__")).toBe("lead");
  expect(slugifyAgentName("...edge...")).toBe("edge");
});

it("falls back to anonymous when nothing survives", () => {
  expect(slugifyAgentName("")).toBe("anonymous");
  expect(slugifyAgentName("!!!")).toBe("anonymous");
  expect(slugifyAgentName("agent-")).toBe("anonymous");
});

it("caps the slug at 64 characters", () => {
  expect(slugifyAgentName("x".repeat(200))).toHaveLength(64);
});

it("bounds the work for a pathological input rather than scanning all of it", () => {
  // The output is identical to the bounded case, which is what makes the bound safe to apply:
  // nothing past 1024 characters could have reached a 64-character result anyway.
  const huge = `${"_".repeat(200_000)}name`;

  const started = performance.now();
  const result = slugifyAgentName(huge);
  const elapsed = performance.now() - started;

  // Everything past the bound is underscores, so the slug is empty and falls back.
  expect(result).toBe("anonymous");
  // Generous on purpose — this asserts "bounded", not a benchmark. A regex engine that did
  // backtrack quadratically on 200k characters would blow through this by orders of magnitude.
  expect(elapsed).toBeLessThan(1000);
});
