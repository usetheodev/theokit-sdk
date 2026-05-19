/**
 * Tests for HookFrontmatter schema (T1.1).
 */

import { describe, expect, it } from "vitest";

import {
  HookFrontmatterSchema,
  parseHookFrontmatter,
} from "../../../src/internal/runtime/hooks-frontmatter.js";

describe("HookFrontmatterSchema", () => {
  it("accepts a minimal valid hook", () => {
    const parsed = HookFrontmatterSchema.safeParse({
      event: "preToolUse",
      matcher: "^shell$",
      command: "node x.js",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.enabled).toBe(true); // default
      expect(parsed.data.priority).toBe(0); // default
    }
  });

  it("rejects unknown event", () => {
    const parsed = HookFrontmatterSchema.safeParse({
      event: "preNonsense",
      matcher: "^x$",
      command: "echo",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty matcher", () => {
    const parsed = HookFrontmatterSchema.safeParse({
      event: "preToolUse",
      matcher: "",
      command: "echo",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty command", () => {
    const parsed = HookFrontmatterSchema.safeParse({
      event: "preToolUse",
      matcher: "^x$",
      command: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects priority as string", () => {
    const parsed = HookFrontmatterSchema.safeParse({
      event: "preToolUse",
      matcher: "^x$",
      command: "echo",
      priority: "high",
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults enabled=true and priority=0 when omitted", () => {
    const parsed = HookFrontmatterSchema.safeParse({
      event: "preToolUse",
      matcher: "^x$",
      command: "echo",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.enabled).toBe(true);
      expect(parsed.data.priority).toBe(0);
    }
  });
});

describe("parseHookFrontmatter", () => {
  it("wraps Zod errors in ConfigurationError with code hook_frontmatter_invalid", () => {
    expect(() => parseHookFrontmatter({ event: "invalid" }, "test-hook")).toThrowError(
      /Invalid hook frontmatter for "test-hook"/,
    );
    try {
      parseHookFrontmatter({ event: "invalid" }, "test-hook");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("hook_frontmatter_invalid");
    }
  });
});
