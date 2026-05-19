/**
 * Tests for lifecycle helpers (T1.4).
 */

import { describe, expect, it, vi } from "vitest";

import {
  runFireAndForgetHooks,
  runTransformHooks,
} from "../../../src/internal/plugins/lifecycle.js";
import type { HookHandler } from "../../../src/internal/plugins/types.js";

describe("runFireAndForgetHooks (T1.4)", () => {
  it("runs all handlers", async () => {
    const calls: number[] = [];
    const handlers: HookHandler[] = [
      () => {
        calls.push(1);
      },
      () => {
        calls.push(2);
      },
      () => {
        calls.push(3);
      },
    ];
    await runFireAndForgetHooks(handlers, {});
    expect(calls).toEqual([1, 2, 3]);
  });

  it("one throws, others continue (logged to stderr)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: number[] = [];
    const handlers: HookHandler[] = [
      () => {
        calls.push(1);
      },
      () => {
        throw new Error("boom");
      },
      () => {
        calls.push(3);
      },
    ];
    await runFireAndForgetHooks(handlers, {});
    expect(calls).toEqual([1, 3]);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe("runTransformHooks (T1.4)", () => {
  it("chains handlers passing the value", async () => {
    const handlers: HookHandler[] = [(v) => (v as number) + 1, (v) => (v as number) * 2];
    const result = await runTransformHooks(handlers, 3);
    expect(result).toBe(8); // (3+1)*2
  });

  it("undefined keeps current", async () => {
    const handlers: HookHandler[] = [(_v) => undefined];
    const result = await runTransformHooks(handlers, 5);
    expect(result).toBe(5);
  });

  it("EC-6: null replaces current explicitly", async () => {
    const handlers: HookHandler[] = [(_v) => null];
    const result = await runTransformHooks(handlers, "initial");
    expect(result).toBeNull();
  });

  it("throw keeps current", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const handlers: HookHandler[] = [
      (_v) => {
        throw new Error("boom");
      },
    ];
    const result = await runTransformHooks(handlers, "x");
    expect(result).toBe("x");
    stderrSpy.mockRestore();
  });
});
