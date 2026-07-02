import { describe, expect, it } from "vitest";
import { PluginManager } from "../../../src/internal/plugins/manager.js";
import type { Plugin } from "../../../src/internal/plugins/types.js";

/**
 * #65 — 7 of 10 declared plugin hooks were silent no-ops (never invoked). Each
 * now has a run*Hooks method + an invocation site. These tests prove each runner
 * invokes its registered handler; the loop-site wiring is covered by the full
 * agent-loop suite + the wiring review.
 */
function pluginOn(hook: string, fn: (...a: unknown[]) => unknown): Plugin {
  return {
    name: `p-${hook}`,
    version: "1.0",
    kind: "general",
    register: (ctx) => {
      ctx.on(hook as never, fn as never);
    },
  };
}

const sessionCtx = { agentId: "a", runId: "r" };

describe("previously-dead plugin hooks are wired (#65)", () => {
  it("post_tool_call fires with the tool result", async () => {
    let seen: unknown;
    const mgr = new PluginManager();
    await mgr.initialize([pluginOn("post_tool_call", (c) => (seen = c))]);
    await mgr.runPostToolCallHooks({
      name: "shell",
      args: {},
      result: { stdout: "ok", stderr: "", exitCode: 0 },
      ...sessionCtx,
    });
    expect(seen).toMatchObject({ name: "shell", result: { stdout: "ok" } });
  });

  it("pre_llm_call and post_llm_call both fire", async () => {
    const fired: string[] = [];
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginOn("pre_llm_call", () => fired.push("pre")),
      pluginOn("post_llm_call", () => fired.push("post")),
    ]);
    await mgr.runPreLlmCallHooks({ ...sessionCtx, iteration: 0 });
    await mgr.runPostLlmCallHooks({ ...sessionCtx, iteration: 0 });
    expect(fired).toEqual(["pre", "post"]);
  });

  it("on_session_start and on_session_end both fire", async () => {
    const fired: string[] = [];
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginOn("on_session_start", () => fired.push("start")),
      pluginOn("on_session_end", () => fired.push("end")),
    ]);
    await mgr.runOnSessionStartHooks(sessionCtx);
    await mgr.runOnSessionEndHooks(sessionCtx);
    expect(fired).toEqual(["start", "end"]);
  });

  it("transform_tool_result folds — a handler's return replaces the payload", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginOn("transform_tool_result", (results) => [...(results as string[]), "added"]),
    ]);
    const out = await mgr.runTransformToolResultHooks(["orig"], sessionCtx);
    expect(out).toEqual(["orig", "added"]);
  });

  it("transform_llm_output folds the text", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([pluginOn("transform_llm_output", (text) => `${text as string}!`)]);
    expect(await mgr.runTransformLlmOutputHooks("hi", sessionCtx)).toBe("hi!");
  });

  it("EC-2: a throwing transform hook does NOT corrupt the payload", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginOn("transform_tool_result", () => {
        throw new Error("boom");
      }),
    ]);
    // The throw is caught + logged; the original payload flows through unchanged.
    const out = await mgr.runTransformToolResultHooks(["safe"], sessionCtx);
    expect(out).toEqual(["safe"]);
  });

  it("a fire-and-forget hook error does not throw out of the runner", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginOn("post_tool_call", () => {
        throw new Error("boom");
      }),
    ]);
    await expect(
      mgr.runPostToolCallHooks({
        name: "x",
        args: {},
        result: { stdout: "", stderr: "", exitCode: 0 },
        ...sessionCtx,
      }),
    ).resolves.toBeUndefined();
  });
});
