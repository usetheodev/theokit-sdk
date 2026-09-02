/**
 * The child agent's lifecycle: disposal on both paths, depth limits, cancellation, empty input.
 *
 * Split out of `subagent-delegation.test.ts` (2026-09-02). One reason to change: what happens to
 * the child around the delegation, as opposed to what it is told.
 */
import { describe, expect, it, vi } from "vitest";
import { MaxDelegationDepthError, SubAgent } from "../../src/a2a/subagent.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

describe("SubAgent lifecycle", () => {
  it("disposes child agent after completion", async () => {
    const mockDispose = vi.fn();
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "done" }) }),
        dispose: mockDispose,
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    await tool.handler({ input: "task" });
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it("disposes child agent even on error", async () => {
    const mockDispose = vi.fn();
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("send failed")) }),
        dispose: mockDispose,
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    await expect(tool.handler({ input: "task" })).rejects.toThrow("send failed");
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it("uses custom model when specified", () => {
    const tool = SubAgent.create({
      name: "coder",
      description: "Codes",
      instructions: "Code.",
      model: "claude-opus-4",
    });
    expect(tool).toBeDefined();
  });

  it("throws MaxDelegationDepthError at depth limit (EC-2)", () => {
    expect(() =>
      SubAgent.create({ name: "deep", description: "Too deep", instructions: "Go deeper." }, 3),
    ).toThrow(MaxDelegationDepthError);
  });

  it("allows depth within limit", () => {
    expect(() =>
      SubAgent.create({ name: "ok", description: "OK depth", instructions: "OK." }, 2),
    ).not.toThrow();
  });

  it("handles empty input without crashing (EC-6)", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "" }) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "empty",
      description: "Handles empty",
      instructions: "Handle it.",
    });
    const result = await tool.handler({ input: "" });
    expect(result).toBe("");
  });

  it("returns (no response) when finalText is undefined", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: undefined }) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "quiet",
      description: "Silent agent",
      instructions: "Be quiet.",
    });
    const result = await tool.handler({ input: "hello" });
    expect(result).toBe("(no response)");
  });

  it("forwards ctx.signal to the child agent.send (SE10 — cancellation propagation)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    const controller = new AbortController();
    await tool.handler({ input: "task" }, { signal: controller.signal });

    // The parent run's AbortSignal must reach the child so aborting the parent
    // cancels the in-flight subagent at its next step.
    expect(mockSend).toHaveBeenCalledWith("task", {
      signal: controller.signal,
      origin: { kind: "coordinator" },
    });
  });

  it("omits signal when invoked without ctx (SE10 — single-arg back-compat)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    await tool.handler({ input: "task" });

    // No ctx ⇒ no signal option: exactly the pre-SE10 call shape.
    expect(mockSend).toHaveBeenCalledWith("task", { origin: { kind: "coordinator" } });
  });

  it("omits signal when ctx is present but ctx.signal is undefined (SE10 — undefined-signal edge)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    // ctx present, signal absent (e.g. a run started without an AbortSignal) →
    // the `ctx?.signal !== undefined` guard must fall through to the no-option path.
    await tool.handler({ input: "task" }, { context: { something: true } });

    expect(mockSend).toHaveBeenCalledWith("task", { origin: { kind: "coordinator" } });
  });

  it("respects custom maxDelegationDepth", () => {
    expect(() =>
      SubAgent.create(
        {
          name: "custom",
          description: "Custom depth",
          instructions: "Custom.",
          maxDelegationDepth: 5,
        },
        4,
      ),
    ).not.toThrow();

    expect(() =>
      SubAgent.create(
        {
          name: "custom",
          description: "Custom depth",
          instructions: "Custom.",
          maxDelegationDepth: 5,
        },
        5,
      ),
    ).toThrow(MaxDelegationDepthError);
  });

  // SE11 — delegation lifecycle hooks.
});
