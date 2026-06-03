/**
 * RED tests for T4.1 — @theokit/react useAction hook (state machine).
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 4 / T4.1 + ADR D2.
 *
 * Tests target the action-invoker contract + reducer transitions via the
 * pure helpers exposed for testing. Full renderHook coverage deferred to
 * dogfood-app E2E (Phase 6 fixture + Chrome MCP) — avoids @testing-library/
 * react dep growth in the SDK package for a hook that will be exercised
 * end-to-end by the consumer.
 */
import { describe, expect, it, vi } from "vitest";

import { __testInternals, type ActionErrorLike } from "../src/use-action.js";

const { unwrap, normalizeError, toError, INITIAL_STATE } = __testInternals;

describe("useAction internals — unwrap", () => {
  it("should pass-through {data, error} envelopes", () => {
    const env = { data: 42, error: undefined };
    expect(unwrap(env)).toBe(env);
  });

  it("should wrap bare value as {data: value, error: undefined}", () => {
    expect(unwrap(42)).toEqual({ data: 42, error: undefined });
  });

  it("should wrap bare object value (no `data` key) as {data}", () => {
    expect(unwrap({ id: "X" })).toEqual({ data: { id: "X" }, error: undefined });
  });

  it("should respect envelope with both data + error fields", () => {
    const env = { data: undefined, error: { code: "X", message: "y" } };
    expect(unwrap(env)).toBe(env);
  });
});

describe("useAction internals — normalizeError", () => {
  it("should pass-through ActionErrorLike-shaped objects", () => {
    const err: ActionErrorLike = { code: "UNAUTHORIZED", message: "no auth" };
    expect(normalizeError(err)).toEqual(err);
  });

  it("should wrap Error instance with INTERNAL_SERVER_ERROR code", () => {
    const wrapped = normalizeError(new Error("boom"));
    expect(wrapped.code).toBe("INTERNAL_SERVER_ERROR");
    expect(wrapped.message).toBe("boom");
  });

  it("should wrap non-Error throwables via String()", () => {
    expect(normalizeError("plain string").message).toBe("plain string");
    expect(normalizeError(42).message).toBe("42");
  });
});

describe("useAction internals — toError", () => {
  it("should produce Error with message + assigned ActionError fields", () => {
    const wrapped = toError({ code: "VALIDATION_ERROR", message: "bad", status: 422 });
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("bad");
    expect((wrapped as Error & { code?: string }).code).toBe("VALIDATION_ERROR");
    expect((wrapped as Error & { status?: number }).status).toBe(422);
  });
});

describe("useAction internals — INITIAL_STATE", () => {
  it("should be idle with no data/error/variables", () => {
    expect(INITIAL_STATE).toEqual({
      status: "idle",
      data: undefined,
      error: undefined,
      variables: undefined,
    });
  });
});

describe("useAction internals — action invocation pattern (mock)", () => {
  it("should accept bare-promise invoker (proxy from @theo/actions)", async () => {
    const action = vi.fn(async (input: { x: number }) => input.x * 2);
    const result = await action({ x: 21 });
    const unwrapped = unwrap(result);
    expect(unwrapped.data).toBe(42);
    expect(unwrapped.error).toBeUndefined();
  });

  it("should accept envelope invoker (typed-client safe-result)", async () => {
    const action = vi.fn(async () => ({ data: "X", error: undefined }));
    const unwrapped = unwrap(await action());
    expect(unwrapped.data).toBe("X");
  });

  it("should surface error envelope from invoker", async () => {
    const err: ActionErrorLike = { code: "NOT_FOUND", message: "missing" };
    const action = vi.fn(async () => ({ data: undefined, error: err }));
    const unwrapped = unwrap(await action());
    expect(unwrapped.error).toEqual(err);
  });
});
