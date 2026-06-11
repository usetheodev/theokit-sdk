/**
 * T5.5 — NUL byte (and control-char) rejection across path-guard +
 * sanitizeIdentifier (DR6 finding #5).
 *
 * Pre-T5.5 `safePathJoin`, `assertNoSymlinkEscape`, and
 * `sanitizeIdentifier` did NOT explicitly reject NUL bytes (`\x00`)
 * or other C0 control characters (`\x01`-`\x1F` + `\x7F`). NUL bytes
 * in path strings have a long history of security bugs: in many
 * lower-level syscalls (Node ≤ 20 issued a TypeError; some legacy
 * callers via N-API truncated the path silently at the NUL). C0
 * controls are universally invalid in POSIX paths and identifiers.
 *
 * `validateArtifactPath` already rejected `\x00` (T1.4 — line 269);
 * T5.5 propagates the same defense to the sibling primitives so a
 * caller can never bypass NUL/control checks by choosing a different
 * entrypoint into the path-guard module.
 */

import { describe, expect, it } from "vitest";
import { safePathJoin, sanitizeIdentifier } from "../../../src/internal/security/index.js";
import { assertNoSymlinkEscape } from "../../../src/internal/security/path-guard.js";

describe("T5.5 — safePathJoin rejects NUL + control chars", () => {
  it("rejects NUL byte in `base`", () => {
    expect(() => safePathJoin("/tmp\x00bad", "file.txt")).toThrow(/nul|control/i);
  });

  it("rejects NUL byte in a `parts` segment", () => {
    expect(() => safePathJoin("/tmp", "file\x00.txt")).toThrow(/nul|control/i);
  });

  it("rejects DEL (0x7F) in `parts`", () => {
    expect(() => safePathJoin("/tmp", "file\x7F.txt")).toThrow(/nul|control/i);
  });

  it("rejects C0 control char (0x01) in a parts segment", () => {
    expect(() => safePathJoin("/tmp", "\x01file.txt")).toThrow(/nul|control/i);
  });

  it("accepts a clean path unchanged", () => {
    const out = safePathJoin("/tmp", "sub", "file.txt");
    expect(out).toMatch(/\/tmp\/sub\/file\.txt$/);
  });
});

describe("T5.5 — assertNoSymlinkEscape rejects NUL", () => {
  it("rejects NUL byte in path string", () => {
    expect(() => assertNoSymlinkEscape("/tmp\x00bad/file.txt", "/tmp")).toThrow(/nul|control/i);
  });

  it("rejects control char in path string", () => {
    expect(() => assertNoSymlinkEscape("/tmp/\x05file", "/tmp")).toThrow(/nul|control/i);
  });
});

describe("T5.5 — sanitizeIdentifier rejects NUL + control chars with specific message", () => {
  it("rejects NUL byte with a specific error pointing at the cause", () => {
    expect(() => sanitizeIdentifier("abc\x00def")).toThrow(/nul|control|invalid/i);
  });

  it("rejects DEL (0x7F)", () => {
    expect(() => sanitizeIdentifier("abc\x7Fdef")).toThrow(/nul|control|invalid/i);
  });

  it("rejects C0 control char", () => {
    expect(() => sanitizeIdentifier("abc\x1Fdef")).toThrow(/nul|control|invalid/i);
  });

  it("still accepts a clean identifier", () => {
    expect(sanitizeIdentifier("valid-id_123")).toBe("valid-id_123");
  });
});
