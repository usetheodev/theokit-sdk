/**
 * Tests for cache-discipline-guard (T3.1, ADRs D94-D95).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertAppendOnly,
  assertSystemPromptStable,
  assertToolsetStable,
} from "../../src/internal/cache-discipline-guard.js";

const stderrSpy = vi.spyOn(process.stderr, "write");

beforeEach(() => {
  stderrSpy.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertSystemPromptStable (T3.1)", () => {
  it("no warn when prompt is stable", () => {
    assertSystemPromptStable("prompt", "prompt", "test");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("warn when prompt changed", () => {
    assertSystemPromptStable("prompt-a", "prompt-b", "test reason");
    expect(stderrSpy).toHaveBeenCalled();
    const msg = (stderrSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(msg).toContain("system prompt changed");
    expect(msg).toContain("test reason");
  });

  it("EC-1: silent when NODE_ENV=production (via vi.stubEnv)", () => {
    vi.stubEnv("NODE_ENV", "production");
    assertSystemPromptStable("a", "b", "test");
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("assertToolsetStable (T3.1)", () => {
  it("warns when toolset names change", () => {
    assertToolsetStable([{ name: "a" }], [{ name: "a" }, { name: "b" }], "added b");
    expect(stderrSpy).toHaveBeenCalled();
    expect((stderrSpy.mock.calls[0]?.[0] as string) ?? "").toContain("toolset changed");
  });

  it("silent when identical", () => {
    assertToolsetStable([{ name: "a" }, { name: "b" }], [{ name: "a" }, { name: "b" }], "same");
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("assertAppendOnly (T3.1)", () => {
  it("warns on mutation of existing item (by reference)", () => {
    // Share the first ref so index 0 is identical; index 1 differs.
    const item0 = { id: 1 };
    assertAppendOnly([item0, { id: 2 }], [item0, { id: 99 }], "mutated [1]");
    expect(stderrSpy).toHaveBeenCalled();
    expect((stderrSpy.mock.calls[0]?.[0] as string) ?? "").toContain("history mutation at index 1");
  });

  it("silent on pure append", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    assertAppendOnly([a], [a, b], "append b");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("warns when history shrinks", () => {
    assertAppendOnly([{ id: 1 }, { id: 2 }], [{ id: 1 }], "removed last");
    expect(stderrSpy).toHaveBeenCalled();
    expect((stderrSpy.mock.calls[0]?.[0] as string) ?? "").toContain("history shrank");
  });
});
