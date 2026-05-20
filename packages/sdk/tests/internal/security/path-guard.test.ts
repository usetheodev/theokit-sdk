/**
 * Tests for canonical path-guard module (T1.1-T1.3, ADRs D79-D81).
 *
 * Covers `safePathJoin`, `assertNoSymlinkEscape`, `sanitizeIdentifier`,
 * `PathTraversalError` — the centralized defense surface against path
 * traversal vectors (Hermes v0.2 #220 #65 #192 #63 #386 #61, v0.5 #3250,
 * v0.7 #4318).
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import {
  assertNoSymlinkEscape,
  PathTraversalError,
  safePathJoin,
  sanitizeIdentifier,
} from "../../../src/internal/security/path-guard.js";

describe("safePathJoin (T1.1)", () => {
  it("accepts nested safe path", () => {
    const result = safePathJoin("/base", "sub", "file.txt");
    expect(result).toBe(resolve("/base", "sub", "file.txt"));
  });

  it("rejects literal '..'", () => {
    expect(() => safePathJoin("/base", "..")).toThrow(PathTraversalError);
  });

  it("rejects absolute path segment", () => {
    expect(() => safePathJoin("/base", "/etc/passwd")).toThrow(PathTraversalError);
  });

  it("rejects normalized escape via multiple segments", () => {
    expect(() => safePathJoin("/base", "subdir/..", "..", "etc")).toThrow(PathTraversalError);
  });

  it("accepts internal dotdot that normalizes to base", () => {
    const result = safePathJoin("/base", "subdir/..");
    expect(result).toBe(resolve("/base"));
  });

  it("accepts empty segment list", () => {
    const result = safePathJoin("/base");
    expect(result).toBe(resolve("/base"));
  });

  it("throws for empty base", () => {
    expect(() => safePathJoin("", "foo")).toThrow(/base must be non-empty/);
  });

  it("PathTraversalError has code 'path_traversal'", () => {
    try {
      safePathJoin("/base", "..");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PathTraversalError);
      expect(err).toBeInstanceOf(ConfigurationError);
      expect((err as PathTraversalError).code).toBe("path_traversal");
    }
  });

  it("EC-4: case-sensitive prefix check (syntactic, not semantic)", () => {
    // Documents that safePathJoin is syntactic — case-insensitive filesystems
    // (macOS, Windows) might allow ../base/file == /Base/file semantically,
    // but safePathJoin rejects to preserve string-level invariants.
    expect(() => safePathJoin("/Base", "..", "base", "file")).toThrow(PathTraversalError);
  });
});

describe("assertNoSymlinkEscape (T1.2)", () => {
  let tmpRoot: string;
  let baseDir: string;

  function setup() {
    tmpRoot = mkdtempSync(join(tmpdir(), "path-guard-test-"));
    baseDir = join(tmpRoot, "base");
    mkdirSync(baseDir, { recursive: true });
  }

  function teardown() {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  it("no-op for regular file", () => {
    setup();
    try {
      const regular = join(baseDir, "regular.txt");
      writeFileSync(regular, "hello");
      expect(() => assertNoSymlinkEscape(regular, baseDir)).not.toThrow();
    } finally {
      teardown();
    }
  });

  it("no-op for nonexistent path", () => {
    setup();
    try {
      expect(() => assertNoSymlinkEscape(join(baseDir, "missing"), baseDir)).not.toThrow();
    } finally {
      teardown();
    }
  });

  it("accepts symlink pointing inside base", () => {
    setup();
    try {
      const target = join(baseDir, "target.txt");
      writeFileSync(target, "ok");
      const link = join(baseDir, "link");
      symlinkSync(target, link);
      expect(() => assertNoSymlinkEscape(link, baseDir)).not.toThrow();
    } finally {
      teardown();
    }
  });

  it("rejects symlink pointing to /etc/passwd", () => {
    setup();
    try {
      const link = join(baseDir, "evil");
      symlinkSync("/etc/passwd", link);
      expect(() => assertNoSymlinkEscape(link, baseDir)).toThrow(PathTraversalError);
    } finally {
      teardown();
    }
  });

  it("rejects relative symlink that escapes base", () => {
    setup();
    try {
      const link = join(baseDir, "rel-escape");
      symlinkSync("../../etc/passwd", link);
      expect(() => assertNoSymlinkEscape(link, baseDir)).toThrow(PathTraversalError);
    } finally {
      teardown();
    }
  });

  it("EC-1: rejects multi-level symlink chain escape via realpathSync", () => {
    setup();
    try {
      // A → B (in base) → C (outside base)
      const outside = join(tmpRoot, "outside.txt");
      writeFileSync(outside, "secret");
      const linkB = join(baseDir, "B");
      symlinkSync(outside, linkB);
      const linkA = join(baseDir, "A");
      symlinkSync(linkB, linkA);
      // Without realpathSync, A → B is checked → B is in base → PASS (bug).
      // With realpathSync, A resolves all the way to outside → REJECT.
      expect(() => assertNoSymlinkEscape(linkA, baseDir)).toThrow(PathTraversalError);
    } finally {
      teardown();
    }
  });
});

describe("sanitizeIdentifier (T1.3)", () => {
  it("accepts alphanumeric", () => {
    expect(sanitizeIdentifier("foo123")).toBe("foo123");
  });

  it("accepts dashes and underscores after first char", () => {
    expect(sanitizeIdentifier("foo-bar_baz")).toBe("foo-bar_baz");
  });

  it("lowercases output", () => {
    expect(sanitizeIdentifier("FooBar")).toBe("foobar");
  });

  it("rejects empty string", () => {
    expect(() => sanitizeIdentifier("")).toThrow(ConfigurationError);
  });

  it("rejects dotdot", () => {
    expect(() => sanitizeIdentifier("..")).toThrow(/invalid characters/);
  });

  it("rejects slash", () => {
    expect(() => sanitizeIdentifier("foo/bar")).toThrow(/invalid characters/);
  });

  it("rejects leading underscore (security: --rm-style flag mimic)", () => {
    expect(() => sanitizeIdentifier("_invalid")).toThrow(/invalid characters/);
  });

  it("rejects over maxLen", () => {
    const long = "a".repeat(65);
    expect(() => sanitizeIdentifier(long)).toThrow(/length out of range/);
  });

  it("accepts custom maxLen", () => {
    const long = "a".repeat(128);
    expect(sanitizeIdentifier(long, { maxLen: 128 })).toBe(long);
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeIdentifier("foo\0bar")).toThrow(/invalid characters/);
  });

  it("rejects spaces", () => {
    expect(() => sanitizeIdentifier("foo bar")).toThrow(/invalid characters/);
  });

  it("accepts realistic agent ID formats (UUID-style)", () => {
    expect(sanitizeIdentifier("agent-02897280-f155-4044-bbd6-0cc5ef8bf194", { maxLen: 64 })).toBe(
      "agent-02897280-f155-4044-bbd6-0cc5ef8bf194",
    );
    expect(sanitizeIdentifier("bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa", { maxLen: 64 })).toBe(
      "bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa",
    );
    expect(sanitizeIdentifier("cli-bot-paulo")).toBe("cli-bot-paulo");
    expect(sanitizeIdentifier("tg-dogfood-chat-A")).toBe("tg-dogfood-chat-a");
  });
});
