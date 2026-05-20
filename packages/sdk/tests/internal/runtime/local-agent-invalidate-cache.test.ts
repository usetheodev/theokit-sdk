/**
 * Tests for Agent.invalidateCache API (T3.2 + T4.3, ADR D94).
 */

import { describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";

const FIXTURE_KEY = "theo_test_fixture_key_for_invalidate_cache_tests";

function uid(): string {
  return `invalidate-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("Agent.invalidateCache (T3.2 / T4.3)", () => {
  it("deferred default: records pending without disposing", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    expect(agent.invalidateCache).toBeDefined();
    await agent.invalidateCache?.("test reason");
    // Agent is still usable — not disposed.
    expect(typeof agent.send).toBe("function");
    await agent.dispose();
  });

  it("applyNow=true disposes the agent", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await agent.invalidateCache?.("immediate", { applyNow: true });
    expect(stderrSpy).toHaveBeenCalled();
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(calls).toContain("applyNow disposing agent");
    stderrSpy.mockRestore();
    // Subsequent send must throw (disposed).
    await expect(agent.send("hi")).rejects.toThrow(/disposed/);
  });

  it("idempotent after dispose: no-op", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    await agent.dispose();
    // Calling invalidateCache after dispose is a silent no-op.
    await expect(agent.invalidateCache?.("late")).resolves.toBeUndefined();
  });

  it("records reason in pending state", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    await agent.invalidateCache?.("reload skills");
    // Inspect internal state via test-only getter on the implementation.
    const internal = agent as unknown as {
      invalidationPending?: { reason: string; at: number };
    };
    const pending = internal.invalidationPending;
    expect(pending?.reason).toBe("reload skills");
    await agent.dispose();
  });

  it("EC-5: invalidate after send completion consumed on next send", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    const internal = agent as unknown as {
      invalidationPending?: { reason: string; at: number };
    };
    // First send — no pending.
    const run1 = await agent.send("Return only: first");
    await run1.wait();
    // Now invalidate.
    await agent.invalidateCache?.("after first send");
    expect(internal.invalidationPending?.reason).toBe("after first send");
    // Second send consumes the pending at entry.
    const run2 = await agent.send("Return only: second");
    await run2.wait();
    expect(internal.invalidationPending).toBeUndefined();
    await agent.dispose();
  });

  it("EC-7: refresh failure still clears pending (does not get stuck)", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    // Monkey-patch reload to throw, simulating a failure in MCP refresh.
    const impl = agent as unknown as { reload: () => Promise<void> };
    const origReload = impl.reload.bind(agent);
    impl.reload = async () => {
      throw new Error("simulated reload failure");
    };
    await agent.invalidateCache?.("trigger refresh");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const run = await agent.send("Return only: ok");
    await run.wait();
    stderrSpy.mockRestore();

    const internal = agent as unknown as {
      invalidationPending?: { reason: string; at: number };
    };
    // Pending was cleared even though reload threw.
    expect(internal.invalidationPending).toBeUndefined();
    impl.reload = origReload;
    await agent.dispose();
  });
});
