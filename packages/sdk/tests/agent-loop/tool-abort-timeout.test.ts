import { describe, expect, it } from "vitest";
import type { ToolResult } from "../../src/internal/agent-loop/tool-executors.js";
import { raceToolExecution } from "../../src/internal/agent-loop/tool-timeout.js";

const never = new Promise<ToolResult>(() => {}); // a hung tool
const ok: ToolResult = { stdout: "done", stderr: "", exitCode: 0 };

/**
 * #58 — a tool that never resolves must not wedge the loop; a cancelled run
 * must interrupt an in-flight tool. RED (pre-fix): no such bounding exists.
 */
describe("raceToolExecution — per-tool timeout + abort (#58)", () => {
  it("per_tool_timeout_rejects_typed_error", async () => {
    const start = Date.now();
    const result = await raceToolExecution(never, { timeoutMs: 60 });
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toMatch(/timed out/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("tool_abort_interrupts_in_flight_handler", async () => {
    const controller = new AbortController();
    const p = raceToolExecution(never, { signal: controller.signal });
    controller.abort();
    const result = await p;
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toMatch(/aborted/);
  });

  it("already_aborted_signal_returns_immediately", async () => {
    const result = await raceToolExecution(never, { signal: AbortSignal.abort() });
    expect(result.exitCode).toBe(124);
  });

  it("a_fast_tool_returns_its_own_result", async () => {
    const result = await raceToolExecution(Promise.resolve(ok), { timeoutMs: 1000 });
    expect(result).toEqual(ok);
  });

  it("no_signal_no_timeout_is_passthrough", async () => {
    const p = Promise.resolve(ok);
    expect(raceToolExecution(p, {})).toBe(p); // same reference — zero overhead
  });
});
