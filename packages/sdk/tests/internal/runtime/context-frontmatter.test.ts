/**
 * Tests for ContextSourceFrontmatter schema (T2.1).
 */

import { describe, expect, it } from "vitest";

import {
  ContextSourceFrontmatterSchema,
  parseContextSourceFrontmatter,
} from "../../../src/internal/runtime/context-frontmatter.js";

describe("ContextSourceFrontmatterSchema", () => {
  it("accepts a minimal source", () => {
    const parsed = ContextSourceFrontmatterSchema.safeParse({
      name: "readme",
      path: "README.md",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.enabled).toBe(true);
  });

  it("rejects empty path", () => {
    const parsed = ContextSourceFrontmatterSchema.safeParse({ path: "" });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-positive maxTokens", () => {
    const parsed = ContextSourceFrontmatterSchema.safeParse({
      path: "x.md",
      maxTokens: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults enabled=true", () => {
    const parsed = ContextSourceFrontmatterSchema.safeParse({ path: "x.md" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.enabled).toBe(true);
  });
});

describe("parseContextSourceFrontmatter", () => {
  it("wraps Zod errors with code context_frontmatter_invalid", () => {
    try {
      parseContextSourceFrontmatter({ path: "" }, "test");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("context_frontmatter_invalid");
    }
  });
});
