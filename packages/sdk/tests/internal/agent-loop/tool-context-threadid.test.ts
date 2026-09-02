/**
 * issue #119 — a `CustomTool` handler's `ctx` now carries `threadId` (the run's session/agent
 * identity), so a stateful tool shared across sessions can scope its state per session instead of
 * leaking it. The value is the `AgentLoopInputs.agentId` — the key a caller passes to
 * `Agent.getOrCreate(sessionId, …)`. Without it, a single shared tool closure (the shipped
 * `createTodolistTool()` shape) mixes one user's state into another's.
 */
import { describe, expect, it } from "vitest";
import { executeTool } from "../../../src/internal/agent-loop/tool-executors.js";
import type { AgentLoopInputs, ResolvedTool } from "../../../src/internal/agent-loop/types.js";
import type { LlmToolCallPart } from "../../../src/internal/llm/types.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

type CtxHandler = (
  input: Record<string, unknown>,
  ctx?: { threadId?: string; signal?: AbortSignal; context?: unknown },
) => string | Promise<string>;

function makeInputs(agentId: string): AgentLoopInputs {
  return { agentId, runId: "run-1" } as unknown as AgentLoopInputs;
}

function customTool(handler: CtxHandler): ResolvedTool {
  return {
    name: "probe",
    description: "probe",
    inputSchema: {},
    origin: "custom",
    customHandler: handler as unknown as ResolvedTool["customHandler"],
  };
}

function call(input: Record<string, unknown>): LlmToolCallPart {
  return { type: "tool_use", id: "c1", name: "probe", input };
}

describe("issue #119 — CustomTool ctx.threadId wiring", () => {
  it("test_handler_receives_threadId_equal_to_agent_session_key", async () => {
    let seen: string | undefined;
    const tool = customTool((_input, ctx) => {
      seen = ctx?.threadId;
      return "ok";
    });
    await executeTool(makeInputs("sess-A"), tool, call({}));
    expect(seen).toBe("sess-A");
  });

  it("test_two_sessions_do_not_leak_shared_stateful_tool_when_keyed_by_threadId", async () => {
    // ONE shared handler closure (the leak shape) that keys its state by ctx.threadId.
    const store = new Map<string, string[]>();
    const shared: CtxHandler = (input, ctx) => {
      const key = ctx?.threadId ?? "__default__";
      const items = store.get(key) ?? [];
      const action = (input as { action?: string }).action;
      if (action === "add") items.push((input as { title: string }).title);
      store.set(key, items);
      return items.join(",");
    };
    const tool = customTool(shared);

    await executeTool(makeInputs("sess-A"), tool, call({ action: "add", title: "A-private" }));
    const bList = await executeTool(makeInputs("sess-B"), tool, call({ action: "list" }));

    // Session B must NOT see session A's private item.
    expect(bList.stdout).toBe("");
    const aList = await executeTool(makeInputs("sess-A"), tool, call({ action: "list" }));
    expect(aList.stdout).toBe("A-private");
  });
});
