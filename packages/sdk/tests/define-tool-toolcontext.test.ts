import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Tool } from "../src/define-tool.js";

/**
 * #65 — a tool handler receives an optional ToolContext 2nd argument carrying
 * the run's AbortSignal, so a cooperative handler can observe cancellation.
 */
describe("Tool ToolContext signal (#65)", () => {
  it("tool_handler_receives_ToolContext_signal", async () => {
    const tool = Tool.create({
      name: "probe",
      description: "reports whether it saw an abort signal",
      inputSchema: z.object({}),
      handler: (_input, ctx) => (ctx?.signal?.aborted === true ? "aborted" : "live"),
    });
    const ac = new AbortController();
    ac.abort();
    // The runtime wrapper forwards the ToolContext to the user's handler.
    expect(await tool.handler({}, { signal: ac.signal })).toBe("aborted");
    expect(await tool.handler({}, { signal: new AbortController().signal })).toBe("live");
  });

  it("single-argument handlers still work (backward-compatible)", async () => {
    const tool = Tool.create({
      name: "legacy",
      description: "ignores the context arg",
      inputSchema: z.object({ x: z.number() }),
      handler: (input) => `x=${input.x}`,
    });
    expect(await tool.handler({ x: 5 })).toBe("x=5");
  });
});
