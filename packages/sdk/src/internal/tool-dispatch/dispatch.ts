/**
 * Validate-then-execute dispatch wrapper (T1.3, ADR D89).
 *
 * Orchestrates: repair → lookup → validate → execute. Tool errors NEVER
 * throw — they return as `DispatchResult { isError: true, content }` so
 * the LLM receives the error and can retry (Hermes posture: keep loop
 * linear, let model self-correct).
 *
 * NOTE on handler timeout (EC-11): a handler that never resolves will
 * stall the loop indefinitely. Out of scope for this plan — fix would
 * require an AbortSignal config. Follow-up if observed in production.
 *
 * NOTE on history inflation (EC-15): a handler returning 10MB+ content
 * inflates message history. Compression integration (separate plan) is
 * the canonical mitigation.
 *
 * @internal
 */

import { type RepairableTool, repairToolCall, type ToolCall } from "./repair-middleware.js";

export interface DispatchableTool extends RepairableTool {
  /** Optional schema validator. Returns `{ ok: true, value }` or `{ ok: false, reason }`. */
  validate?: (args: unknown) => { ok: true; value: unknown } | { ok: false; reason: string };
  /** Tool execution. May throw — caught and converted to isError DispatchResult. */
  handler: (args: Record<string, unknown>) => Promise<string> | string;
}

export interface DispatchResult {
  callId: string;
  isError: boolean;
  content: string;
  /** Repairs applied during dispatch (case fix, args parse, type coerce). */
  repairs: string[];
}

/**
 * Dispatch a raw LLM tool call through repair + validate + execute. NEVER
 * throws — all error paths return as `DispatchResult` with `isError: true`.
 *
 * @internal
 */
export async function dispatchToolWithRepair(
  raw: ToolCall,
  registry: ReadonlyMap<string, DispatchableTool>,
): Promise<DispatchResult> {
  const { call, repairs } = repairToolCall(raw, registry);
  const tool = registry.get(call.name);

  if (tool === undefined) {
    const available = [...registry.keys()].join(", ");
    return {
      callId: call.id,
      isError: true,
      content: `Unknown tool: "${call.name}". Available: ${available}`,
      repairs,
    };
  }

  let validatedArgs: unknown = call.args;
  if (tool.validate !== undefined) {
    const v = tool.validate(call.args);
    if (!v.ok) {
      return {
        callId: call.id,
        isError: true,
        content: `Invalid arguments for "${call.name}": ${v.reason}`,
        repairs,
      };
    }
    validatedArgs = v.value;
  }

  try {
    const result = await tool.handler(validatedArgs as Record<string, unknown>);
    return {
      callId: call.id,
      isError: false,
      content: result ?? "",
      repairs,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      callId: call.id,
      isError: true,
      content: `Tool execution failed: ${message}`,
      repairs,
    };
  }
}
