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
import { join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
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

  /**
   * REGRESSION: the filesystem ROOT as base rejected EVERY path.
   *
   * `baseResolved + sep` assumes `baseResolved` does not already end in `sep` — true for every
   * base EXCEPT the root, where `resolve("/") === "/"` makes the prefix `"//"`, which no absolute
   * path starts with. Consequence downstream: a consumer that legitimately lifts its write root to
   * `/` (an unrestricted / "full access" mode) got 100% of its writes refused as `path_traversal`
   * — the most permissive configuration behaved as the most restrictive one.
   *
   * Found from agent-builder M68: `createApplyPatchTool({ projectRoot: "/" })` refused relative
   * AND absolute targets alike.
   */
  it("accepts any path when base is the filesystem root", () => {
    expect(safePathJoin(sep, "a.txt")).toBe(resolve(sep, "a.txt"));
    expect(safePathJoin(sep, resolve(sep, "tmp", "a.txt"))).toBe(resolve(sep, "tmp", "a.txt"));
    expect(safePathJoin(sep, "tmp", "nested", "deep.txt")).toBe(
      resolve(sep, "tmp", "nested", "deep.txt"),
    );
  });

  it("still rejects escape attempts when base is the filesystem root", () => {
    // The root has nothing above it: `..` normalizes back to the root, which IS inside base.
    expect(safePathJoin(sep, "..")).toBe(resolve(sep));
    // A NUL byte is still rejected at the boundary, root base or not.
    // B-079 — was bare `.toThrow()`.
    expect(() => safePathJoin(sep, "a\u0000b")).toThrow(PathTraversalError);
    expect(() => safePathJoin(sep, "a\u0000b")).toThrow(
      expect.objectContaining({ code: "path_traversal" }),
    );
  });

  it("EC-4: case-sensitive prefix check (syntactic, not semantic)", () => {
    // Documents that safePathJoin is syntactic — case-insensitive filesystems
    // (macOS, Windows) might allow ../base/file == /Base/file semantically,
    // but safePathJoin rejects to preserve string-level invariants.
    expect(() => safePathJoin("/Base", "..", "base", "file")).toThrow(PathTraversalError);
  });
});

describe("assertNoSymlinkEscape (T1.2)", () => {
  /**
   * REGRESSION (#149, second occurrence): the SAME containment check existed in two functions
   * of this module, and the first fix covered only `safePathJoin`. With a root base, `assertNoSymlinkEscape`
   * kept rejecting every existing path — so `apply_patch` with `projectRoot: "/"` remained
   * broken even after #149. Both now go through `isInside`, so they cannot diverge again.
   */
  it("accepts an existing path when base is the filesystem root", () => {
    const dir = mkdtempSync(join(tmpdir(), "root-base-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, "x");
    try {
      expect(() => assertNoSymlinkEscape(file, sep)).not.toThrow();
      expect(() => assertNoSymlinkEscape(dir, sep)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  it("DEFENCE-IN-DEPTH: rejects symlink at INTERMEDIATE component (not just terminal)", () => {
    // Real bug class: `base = /project`, `path = /project/inner/file.txt`
    // where `/project/inner → /outside`. lstat on the terminal `file.txt`
    // FOLLOWS the intermediate symlink and reports a regular file — so the
    // old implementation returned without flagging the escape.
    // Fix: realpath the full path (or walk to the nearest existing ancestor
    // when the terminal doesn't exist) to catch symlinks at ANY depth.
    setup();
    try {
      const outsideDir = join(tmpRoot, "outside-dir");
      mkdirSync(outsideDir);
      const secret = join(outsideDir, "secret.txt");
      writeFileSync(secret, "forbidden");

      // base/inner is itself a symlink to outsideDir
      const inner = join(baseDir, "inner");
      symlinkSync(outsideDir, inner);

      // Accessing base/inner/secret.txt physically reads outsideDir/secret.txt
      const escapePath = join(baseDir, "inner", "secret.txt");
      expect(() => assertNoSymlinkEscape(escapePath, baseDir)).toThrow(PathTraversalError);
    } finally {
      teardown();
    }
  });

  it("DEFENCE-IN-DEPTH: rejects intermediate symlink even for not-yet-created file", () => {
    // Variant: the file doesn't exist YET, but an intermediate dir IS a symlink
    // that escapes. An agent doing `write_file('inner/new.txt', ...)` would
    // physically write to outside-dir/new.txt — must be blocked at validation.
    setup();
    try {
      const outsideDir = join(tmpRoot, "outside-future");
      mkdirSync(outsideDir);
      const inner = join(baseDir, "future-inner");
      symlinkSync(outsideDir, inner);

      const willCreate = join(baseDir, "future-inner", "new.txt");
      // file doesn't exist; intermediate symlink does
      expect(() => assertNoSymlinkEscape(willCreate, baseDir)).toThrow(PathTraversalError);
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
    // T5.5 — sanitizeIdentifier now throws a NUL-specific
    // PathTraversalError (more diagnostic than the pre-T5.5 generic
    // "invalid characters" message) so operators can pinpoint the
    // cause.
    expect(() => sanitizeIdentifier("foo\0bar")).toThrow(/nul/i);
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

describe("isForbiddenPath — sensitive-file blocklist", () => {
  // Universal blocklist for coding agents: secrets / VCS / build artefacts /
  // dependency caches / lock files. TheoKit Studio is consumer #1; cli-bot
  // and future agents share the same defaults.

  it("Given .env at root, Then is forbidden", () => {
    expect(isForbiddenPath(".env")).toBe(true);
  });

  it("Given .env.local, Then is forbidden", () => {
    expect(isForbiddenPath(".env.local")).toBe(true);
  });

  it("Given .env.example, Then is NOT forbidden (template safe to read)", () => {
    expect(isForbiddenPath(".env.example")).toBe(false);
  });

  it("Given .git/config, Then is forbidden", () => {
    expect(isForbiddenPath(".git/config")).toBe(true);
  });

  it("Given node_modules/foo/index.js, Then is forbidden", () => {
    expect(isForbiddenPath("node_modules/foo/index.js")).toBe(true);
  });

  it("Given .theo/manifest.json, Then is forbidden", () => {
    expect(isForbiddenPath(".theo/manifest.json")).toBe(true);
  });

  it("Given pnpm-lock.yaml at root, Then is forbidden", () => {
    expect(isForbiddenPath("pnpm-lock.yaml")).toBe(true);
  });

  it("Given package-lock.json at root, Then is forbidden", () => {
    expect(isForbiddenPath("package-lock.json")).toBe(true);
  });

  it("Given yarn.lock at root, Then is forbidden", () => {
    expect(isForbiddenPath("yarn.lock")).toBe(true);
  });

  it("Given bun.lockb at root, Then is forbidden", () => {
    expect(isForbiddenPath("bun.lockb")).toBe(true);
  });

  it("Given app/page.tsx, Then is NOT forbidden", () => {
    expect(isForbiddenPath("app/page.tsx")).toBe(false);
  });

  it("Given Windows-style backslash path, Then is normalized and forbidden", () => {
    // Cross-platform: backslashes must not bypass the blocklist
    expect(isForbiddenPath(".git\\config")).toBe(true);
  });

  it("Given leading ./, Then it is stripped before matching", () => {
    expect(isForbiddenPath("./.env")).toBe(true);
  });

  it("Given empty string, Then is NOT forbidden (caller passes a normalized path)", () => {
    expect(isForbiddenPath("")).toBe(false);
  });

  it("Given ForbiddenPathError is exported, Then it extends ConfigurationError", () => {
    // Consumers can `catch (err) { if (err.code === 'forbidden_path') ... }`.
    const err = new ForbiddenPathError(".env");
    expect(err).toBeInstanceOf(ConfigurationError);
    expect((err as { code?: string }).code).toBe("forbidden_path");
  });
});
