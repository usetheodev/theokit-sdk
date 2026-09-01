/**
 * DispatchResult.errorCode mapping (Production-Readiness #3, T3.4).
 *
 * Validates the 3 error categories surfaced from `dispatchToolWithRepair`:
 * - tool_runtime_error: handler throw
 * - invalid_request: validator failure
 * - unknown: tool name miss
 */

import { describe, expect, it } from "vitest";

import {
  type DispatchableTool,
  dispatchToolWithRepair,
} from "../src/internal/tool-dispatch/dispatch.js";

function makeRegistry(...tools: Array<[string, DispatchableTool]>): Map<string, DispatchableTool> {
  return new Map(tools);
}

describe("DispatchResult.errorCode (T3.4)", () => {
  it("handler throw → errorCode='tool_runtime_error'", async () => {
    const tool: DispatchableTool = {
      name: "broken",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        throw new Error("boom");
      },
    };
    const result = await dispatchToolWithRepair(
      { id: "call_1", name: "broken", args: {} },
      makeRegistry(["broken", tool]),
    );
    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe("tool_runtime_error");
    expect(result.content).toContain("boom");
  });

  it("validate failure → errorCode='invalid_request'", async () => {
    const tool: DispatchableTool = {
      name: "needs-x",
      inputSchema: { type: "object", properties: { x: { type: "string" } } },
      validate: () => ({ ok: false, reason: "missing required field 'x'" }),
      handler: async () => "should not run",
    };
    const result = await dispatchToolWithRepair(
      { id: "call_2", name: "needs-x", args: { y: 1 } },
      makeRegistry(["needs-x", tool]),
    );
    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe("invalid_request");
    expect(result.content).toContain("missing required field");
  });

  it("registry miss → errorCode='unknown'", async () => {
    const result = await dispatchToolWithRepair(
      { id: "call_3", name: "missing-tool", args: {} },
      makeRegistry(),
    );
    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe("unknown");
  });

  it("success → errorCode is undefined", async () => {
    const tool: DispatchableTool = {
      name: "ok-tool",
      inputSchema: { type: "object", properties: {} },
      handler: async () => "ok",
    };
    const result = await dispatchToolWithRepair(
      { id: "call_4", name: "ok-tool", args: {} },
      makeRegistry(["ok-tool", tool]),
    );
    expect(result.isError).toBe(false);
    expect(result.errorCode).toBeUndefined();
  });
});
