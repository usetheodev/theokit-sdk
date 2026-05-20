/**
 * Tests for translate.ts (T5.1).
 */

import { describe, expect, it } from "vitest";

import { toMem0Options } from "../src/translate.js";

describe("Mem0 translate (T5.1)", () => {
  it("maps userId → user_id", () => {
    expect(toMem0Options({ userId: "alice" })).toEqual({ user_id: "alice" });
  });

  it("maps full context to Mem0 options", () => {
    const out = toMem0Options({
      userId: "alice",
      agentId: "coder",
      sessionId: "chat42",
      tenantId: "acme",
      tags: ["jazz", "music"],
      metadata: { source: "test" },
    });
    expect(out).toEqual({
      user_id: "alice",
      agent_id: "coder",
      run_id: "chat42",
      app_id: "acme",
      categories: ["jazz", "music"],
      metadata: { source: "test" },
    });
  });

  it("categories come from ctx.tags", () => {
    const out = toMem0Options({ userId: "alice", tags: ["health"] });
    expect(out.categories).toEqual(["health"]);
  });
});
