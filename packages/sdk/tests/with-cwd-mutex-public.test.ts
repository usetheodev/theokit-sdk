/**
 * `withCwdMutex` public-utility surface tests (SDK 2.0 ADR-008).
 *
 * Pins the contract:
 *   - Exported from `@theokit/sdk` main barrel.
 *   - Same-key calls serialize.
 *   - Different-key calls do NOT serialize (independent).
 *   - Promise rejection from `fn` does not poison subsequent calls.
 *   - Type signature stable: `<T>(key, fn) => Promise<T>`.
 */

import { withCwdMutex } from "@theokit/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("withCwdMutex public utility (ADR-008)", () => {
  it("test_exported_from_main_barrel", () => {
    expect(typeof withCwdMutex).toBe("function");
  });

  it("test_type_signature_stable", () => {
    expectTypeOf(withCwdMutex).toBeFunction();
    // Signature: withCwdMutex<T>(key: string, fn: () => Promise<T>): Promise<T>
    expectTypeOf(withCwdMutex<number>)
      .parameter(0)
      .toEqualTypeOf<string>();
    expectTypeOf(withCwdMutex<number>).returns.toEqualTypeOf<Promise<number>>();
  });

  it("test_same_key_serializes", async () => {
    const order: number[] = [];
    const p1 = withCwdMutex("test-key-A", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return 1;
    });
    const p2 = withCwdMutex("test-key-A", async () => {
      order.push(2);
      return 2;
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("test_different_keys_dont_serialize", async () => {
    const order: number[] = [];
    const p1 = withCwdMutex("test-key-B", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
      return 1;
    });
    const p2 = withCwdMutex("test-key-C", async () => {
      order.push(2);
      return 2;
    });
    await Promise.all([p1, p2]);
    // p2 should complete first because p1 sleeps longer; different keys = no serialization.
    expect(order[0]).toBe(2);
    expect(order[1]).toBe(1);
  });

  it("test_rejection_does_not_poison_subsequent_callers", async () => {
    const p1 = withCwdMutex("test-key-D", async () => {
      throw new Error("first call blew");
    });
    await expect(p1).rejects.toThrow("first call blew");

    // Subsequent call with same key should still run.
    const p2 = withCwdMutex("test-key-D", async () => 42);
    await expect(p2).resolves.toBe(42);
  });

  it("test_returns_fn_resolution_verbatim", async () => {
    const result = await withCwdMutex("test-key-E", async () => ({ ok: true, value: "x" }));
    expect(result).toEqual({ ok: true, value: "x" });
  });
});
