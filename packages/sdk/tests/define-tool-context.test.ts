import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Tool } from "../src/define-tool.js";

/**
 * M7 (theokit-ai-first) — a tool handler receives an optional user `context` on
 * the 2nd ToolContext argument (alongside the run's AbortSignal), so shared
 * config (e.g. `projectRoot`) is provided once at the run and read by every tool
 * instead of being baked into each tool factory. Mirrors ai-sdk `experimental_context`,
 * mastra `RuntimeContext`, openai-agents-js `RunContext`.
 */
describe("Tool ToolContext user context (M7)", () => {
  it("tool_handler_receives_user_context", async () => {
    const tool = Tool.create({
      name: "probe_ctx",
      description: "reports the projectRoot it received from the run context",
      inputSchema: z.object({}),
      handler: (_input, ctx) => {
        const ctxObj = ctx?.context as { projectRoot?: string } | undefined;
        return ctxObj?.projectRoot ?? "no-context";
      },
    });
    expect(await tool.handler({}, { context: { projectRoot: "/repo" } })).toBe("/repo");
    expect(await tool.handler({})).toBe("no-context");
  });

  it("context and signal coexist on the ToolContext (M7 + #65)", async () => {
    const tool = Tool.create({
      name: "probe_both",
      description: "sees both signal and context",
      inputSchema: z.object({}),
      handler: (_input, ctx) => {
        const aborted = ctx?.signal?.aborted === true;
        const ctxObj = ctx?.context as { tenant?: string } | undefined;
        return `${aborted ? "aborted" : "live"}:${ctxObj?.tenant ?? "-"}`;
      },
    });
    const ac = new AbortController();
    ac.abort();
    expect(await tool.handler({}, { signal: ac.signal, context: { tenant: "acme" } })).toBe(
      "aborted:acme",
    );
  });
});
