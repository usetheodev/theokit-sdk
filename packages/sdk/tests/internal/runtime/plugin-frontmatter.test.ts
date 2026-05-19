/**
 * Tests for PluginFrontmatter schema (T3.1).
 */

import { describe, expect, it } from "vitest";

import {
  PluginFrontmatterSchema,
  parsePluginFrontmatter,
} from "../../../src/internal/runtime/plugin-frontmatter.js";

describe("PluginFrontmatterSchema", () => {
  it("accepts minimal plugin (all fields optional)", () => {
    const parsed = PluginFrontmatterSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("accepts a complete plugin", () => {
    const parsed = PluginFrontmatterSchema.safeParse({
      name: "openrouter",
      version: "1.0.0",
      capabilities: ["chat"],
      entry: "index.js",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty name", () => {
    const parsed = PluginFrontmatterSchema.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty entry", () => {
    const parsed = PluginFrontmatterSchema.safeParse({ entry: "" });
    expect(parsed.success).toBe(false);
  });
});

describe("parsePluginFrontmatter", () => {
  it("wraps Zod errors with code plugin_frontmatter_invalid", () => {
    try {
      parsePluginFrontmatter({ entry: "" }, "test-plugin");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("plugin_frontmatter_invalid");
    }
  });
});
