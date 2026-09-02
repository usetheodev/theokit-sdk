/**
 * `onDelegationStart` / `onDelegationComplete`: the two hooks a coordinator gets.
 *
 * Split out of `subagent-delegation.test.ts` (2026-09-02). Sixteen tests, one reason to change:
 * the hook contract — veto, input rewriting, step capping, iteration counting, and what a throwing
 * hook does on each path.
 */
import { describe, expect, it, vi } from "vitest";
import { SubAgent } from "../../src/a2a/subagent.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

describe("SubAgent hooks", () => {
  it("onDelegationStart proceed:false short-circuits with rejectionReason (child never runs)", async () => {
    const mockCreate = vi.fn();
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: false, rejectionReason: "too many iterations" }),
    });
    const result = await tool.handler({ input: "task" });

    expect(result).toBe("too many iterations");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("onDelegationStart modifiedInput rewrites the prompt sent to the child", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: (c) => ({ proceed: true, modifiedInput: `${c.input}\n\nFocus on 2025.` }),
    });
    await tool.handler({ input: "research" });

    expect(mockSend).toHaveBeenCalledWith("research\n\nFocus on 2025.", {
      origin: { kind: "coordinator" },
    });
  });

  it("onDelegationStart modifiedMaxSteps caps the child via maxIterations (SE13)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true, modifiedMaxSteps: 3 }),
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("task", {
      maxIterations: 3,
      origin: { kind: "coordinator" },
    });
  });

  it("modifiedMaxSteps composes with the forwarded signal on one child send (SE13 + SE10)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true, modifiedMaxSteps: 5 }),
    });
    const controller = new AbortController();
    await tool.handler({ input: "task" }, { signal: controller.signal });

    expect(mockSend).toHaveBeenCalledWith("task", {
      signal: controller.signal,
      maxIterations: 5,
      origin: { kind: "coordinator" },
    });
  });

  it("modifiedInput and modifiedMaxSteps combine independently (SE13 + SE11)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true, modifiedInput: "rewritten", modifiedMaxSteps: 4 }),
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("rewritten", {
      maxIterations: 4,
      origin: { kind: "coordinator" },
    });
  });

  it("modifiedMaxSteps applies without an explicit proceed (proceed defaults to allow) (SE13)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ modifiedMaxSteps: 2 }), // no explicit proceed ⇒ not rejected
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("task", {
      maxIterations: 2,
      origin: { kind: "coordinator" },
    });
  });

  it("onDelegationComplete feedback is appended to the child result", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "findings" }) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationComplete: (c) => ({ feedback: ` [reviewed:${c.name}]` }),
    });
    const result = await tool.handler({ input: "task" });

    expect(result).toBe("findings [reviewed:worker]");
  });

  it("onDelegationStart proceed:true without modifiedInput passes the original input through", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true }),
    });
    await tool.handler({ input: "original" });

    expect(mockSend).toHaveBeenCalledWith("original", { origin: { kind: "coordinator" } });
  });

  it("awaits an async onDelegationStart hook (modifiedInput via Promise)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: async (c) => ({ proceed: true, modifiedInput: `async:${c.input}` }),
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("async:task", { origin: { kind: "coordinator" } });
  });

  it("a throwing onDelegationStart propagates (never swallowed)", async () => {
    const mockCreate = vi.fn();
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => {
        throw new Error("gate boom");
      },
    });
    await expect(tool.handler({ input: "task" })).rejects.toThrow("gate boom");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("a throwing onDelegationComplete on the error path does NOT mask the child error", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("child boom")) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationComplete: () => {
        throw new Error("observer boom");
      },
    });
    // The child's real failure wins over the observer hook's throw.
    await expect(tool.handler({ input: "task" })).rejects.toThrow("child boom");
  });

  // SE15 — iteration count on the delegation-hook context.

  it("onDelegationStart sees a 1-based iteration incrementing per invocation (SE15)", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const seen: number[] = [];
    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: (c) => {
        seen.push(c.iteration);
        return { proceed: true };
      },
    });
    await tool.handler({ input: "a" });
    await tool.handler({ input: "b" });
    await tool.handler({ input: "c" });

    expect(seen).toEqual([1, 2, 3]);
  });

  it("a hook rejecting when iteration > 2 lets the first two run and rejects the third (SE15)", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
      dispose: vi.fn(),
    });
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: (c) =>
        c.iteration > 2
          ? { proceed: false, rejectionReason: "too many iterations" }
          : { proceed: true },
    });
    await tool.handler({ input: "a" });
    await tool.handler({ input: "b" });
    const third = await tool.handler({ input: "c" });

    expect(third).toBe("too many iterations");
    expect(mockCreate).toHaveBeenCalledTimes(2); // child ran only for iterations 1 and 2
  });

  it("onDelegationComplete sees the same iteration as onDelegationStart (SE15)", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    let startIter: number | undefined;
    let completeIter: number | undefined;
    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: (c) => {
        startIter = c.iteration;
        return { proceed: true };
      },
      onDelegationComplete: (c) => {
        completeIter = c.iteration;
      },
    });
    await tool.handler({ input: "a" });
    await tool.handler({ input: "b" });

    expect(startIter).toBe(2);
    expect(completeIter).toBe(2);
  });

  it("each SubAgent instance has an independent iteration counter (SE15)", async () => {
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const seenA: number[] = [];
    const seenB: number[] = [];
    const make = (sink: number[]) =>
      SubAgent.create({
        name: "worker",
        description: "Works",
        instructions: "Work.",
        onDelegationStart: (c) => {
          sink.push(c.iteration);
          return { proceed: true };
        },
      });
    const a = make(seenA);
    const b = make(seenB);
    await a.handler({ input: "x" });
    await b.handler({ input: "y" }); // a fresh instance starts at 1, independent of `a`

    expect(seenA).toEqual([1]);
    expect(seenB).toEqual([1]);
  });

  // Concurrency-safety of the iteration surfaced to onDelegationComplete is guaranteed
  // structurally, not by a test: the handler captures `capturedIteration = iteration`
  // synchronously (before ANY await), so a concurrent invocation bumping the shared
  // counter cannot change the value this delegation's start/complete/error hooks observe.
  // (A live concurrency test is omitted — vitest's dynamic-import mock does not apply
  // reliably to two in-flight `import("../agent.js")` calls; the capture is the guarantee.)

  it("onDelegationComplete observes a child error and the error is re-thrown", async () => {
    const onComplete = vi.fn();
    setAgentFacade({
      create: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("boom")) }),
        dispose: vi.fn(),
      }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationComplete: onComplete,
    });
    await expect(tool.handler({ input: "task" })).rejects.toThrow("boom");
    expect(onComplete).toHaveBeenCalledWith(
      // SE15 — the error path also carries the delegation's iteration.
      expect.objectContaining({ name: "worker", error: expect.any(Error), iteration: 1 }),
    );
  });

  // SE12 — opt-in parent-context forwarding via messageFilter.
});
