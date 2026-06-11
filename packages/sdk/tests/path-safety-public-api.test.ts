import { describe, expect, it } from "vitest";

/**
 * Smoke test for the public exposure of path-safety primitives.
 *
 * These were `@internal` until v1.x — Studio (consumer #1) and cli-bot
 * (consumer #2) need them at the API surface so consumers don't reinvent
 * traversal defence. Mirrors the existing `path-guard.test.ts` unit tests
 * for the underlying module; this file pins the *barrel exposure*.
 */

import * as SDK from "../src/path-safety.js";

describe("@theokit/sdk/path-safety — public sub-export", () => {
  it("Given the path-safety module, Then safePathJoin is exported", () => {
    expect(typeof SDK.safePathJoin).toBe("function");
  });

  it("Given the barrel, Then assertNoSymlinkEscape is exported", () => {
    expect(typeof SDK.assertNoSymlinkEscape).toBe("function");
  });

  it("Given the barrel, Then isForbiddenPath is exported", () => {
    expect(typeof SDK.isForbiddenPath).toBe("function");
  });

  it("Given the barrel, Then PathTraversalError is a constructable error class", () => {
    expect(typeof SDK.PathTraversalError).toBe("function");
    const err = new SDK.PathTraversalError("foo", "/escaped");
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe("path_traversal");
  });

  it("Given the barrel, Then ForbiddenPathError is a constructable error class", () => {
    expect(typeof SDK.ForbiddenPathError).toBe("function");
    const err = new SDK.ForbiddenPathError(".env");
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe("forbidden_path");
  });

  it("Given safePathJoin via barrel, Then it still rejects traversal", () => {
    expect(() => SDK.safePathJoin("/base", "..")).toThrow(SDK.PathTraversalError);
  });

  it("Given isForbiddenPath via barrel, Then it still recognises .env", () => {
    expect(SDK.isForbiddenPath(".env")).toBe(true);
    expect(SDK.isForbiddenPath(".env.example")).toBe(false);
    expect(SDK.isForbiddenPath("app/page.tsx")).toBe(false);
  });
});
