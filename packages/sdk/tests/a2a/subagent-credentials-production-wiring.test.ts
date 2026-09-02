/**
 * theokit#148 — the credential scope must be established by the RUN, not by the test.
 *
 * The `/review` found that every theokit#148 test opened `withInheritedSubAgentCredentials` itself,
 * so deleting the production wrap in `real-local-run.ts` left the whole suite green. That is the
 * third recurrence of this bug class (#142 → #143 → #148): each time, the delivery mechanism was
 * verified and the WIRING was not, and each time the symptom reached a user as "(no response)".
 *
 * So this file establishes no scope. It drives `createRealLocalRun` and asserts a delegated child
 * received the parent's credentials — which can only happen if the run itself published them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubAgent } from "../../src/a2a/subagent.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import type { CustomTool } from "../../src/types/agent.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const childOptions: Array<Record<string, unknown>> = [];

/**
 * The loop is mocked, but it INVOKES the subagent tool — which is the whole point. A mock that
 * merely returns would prove nothing about the scope enclosing dispatch.
 */
vi.mock("../../src/internal/agent-loop/loop.js", () => ({
  runAgentLoop: vi.fn(async (inputs: { customTools?: ReadonlyArray<CustomTool> }) => {
    const delegate = inputs.customTools?.find((t) => t.name === "researcher");
    if (delegate !== undefined) await delegate.handler({ input: "go" });
    return { events: [], finalStatus: "completed", result: "ok", conversation: [] };
  }),
}));

const { createRealLocalRun } = await import("../../src/internal/local-agent/real-local-run.js");

describe("theokit#148 — the run establishes the credential scope", () => {
  beforeEach(() => {
    childOptions.length = 0;
    setAgentFacade({
      create: vi.fn(async (options: Record<string, unknown>) => {
        childOptions.push(options);
        return {
          send: vi.fn(async () => ({ wait: async () => ({ result: "child ok" }) })),
          dispose: vi.fn(),
        };
      }),
    } as unknown as AgentFacadePort);
  });

  it("test_a_delegated_child_inherits_the_parents_apiKey_without_the_test_opening_a_scope", async () => {
    const run = createRealLocalRun({
      agentId: "agent-wiring-1",
      model: { id: "claude-sonnet-4-6" },
      message: "delegate it",
      agentOptions: {
        apiKey: "sk-ant-parent-key",
        model: { id: "claude-sonnet-4-6" },
        tools: [SubAgent.create({ name: "researcher", description: "d", instructions: "i" })],
      },
      sendOptions: {},
      workspaceCwd: process.cwd(),
      hooks: {} as never,
    } as never);
    await run.wait();

    expect(childOptions, "the subagent must have been dispatched").toHaveLength(1);
    // Deleting `withInheritedSubAgentCredentials(...)` from executeAgentLoop fails exactly here.
    expect(childOptions[0]).toMatchObject({
      apiKey: "sk-ant-parent-key",
      model: { id: "claude-sonnet-4-6" },
    });
  });

  it("test_COUNTERPROOF_the_child_gets_THIS_parents_key_not_a_constant", async () => {
    // A second run with a different credential. Without this, the assertion above could be passing
    // on a hard-coded value — and a cross-tenant leak would read as a pass.
    //
    // (A parent with NO apiKey would be the sharper counterproof, but provider resolution fails
    // before dispatch in that case, so the subagent never runs and the test would assert nothing.)
    const run = createRealLocalRun({
      agentId: "agent-wiring-2",
      model: { id: "claude-sonnet-4-6" },
      message: "delegate it",
      agentOptions: {
        apiKey: "sk-ant-a-completely-different-key",
        model: { id: "claude-sonnet-4-6" },
        tools: [SubAgent.create({ name: "researcher", description: "d", instructions: "i" })],
      },
      sendOptions: {},
      workspaceCwd: process.cwd(),
      hooks: {} as never,
    } as never);
    await run.wait();

    expect(childOptions).toHaveLength(1);
    expect(childOptions[0]).toMatchObject({ apiKey: "sk-ant-a-completely-different-key" });
  });
});
