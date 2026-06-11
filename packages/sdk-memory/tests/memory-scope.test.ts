import { describe, expect, it } from "vitest";

import { MemoryScope, normalizeScopePath } from "../src/internal/memory-scope.js";

describe("normalizeScopePath", () => {
  it("root stays root", () => {
    expect(normalizeScopePath("/")).toBe("/");
  });

  it("adds leading slash", () => {
    expect(normalizeScopePath("crew/agent")).toBe("/crew/agent");
  });

  it("removes trailing slash", () => {
    expect(normalizeScopePath("/crew/agent/")).toBe("/crew/agent");
  });

  it("collapses double slashes", () => {
    expect(normalizeScopePath("//crew///agent")).toBe("/crew/agent");
  });

  it("empty string becomes root", () => {
    expect(normalizeScopePath("")).toBe("/");
  });

  it("preserves deep paths", () => {
    expect(normalizeScopePath("/company/engineering/research/decisions")).toBe(
      "/company/engineering/research/decisions",
    );
  });
});

describe("MemoryScope", () => {
  it("child produces correct path", () => {
    const scope = new MemoryScope("/crew");
    const child = scope.child("agent-1");
    expect(child.path).toBe("/crew/agent-1");
  });

  it("nested children produce correct path", () => {
    const root = new MemoryScope("/");
    const child = root.child("a").child("b").child("c");
    expect(child.path).toBe("/a/b/c");
  });

  it("search options contain scopePrefix", () => {
    const scope = new MemoryScope("/crew/research");
    expect(scope.toSearchOptions().scopePrefix).toBe("/crew/research");
  });

  it("child with absolute path strips leading slash (EC-5)", () => {
    const scope = new MemoryScope("/crew");
    const child = scope.child("/agent");
    expect(child.path).toBe("/crew/agent");
  });

  it("root scope path is /", () => {
    const scope = new MemoryScope("/");
    expect(scope.path).toBe("/");
  });

  it("scope from unnormalized path normalizes", () => {
    const scope = new MemoryScope("///crew//agent///");
    expect(scope.path).toBe("/crew/agent");
  });
});
