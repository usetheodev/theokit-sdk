import { describe, expect, it, vi } from "vitest";

import { MaxDelegationDepthError, SubAgent } from "../../src/a2a/subagent.js";

describe("SubAgent", () => {
  it("returns a CustomTool with name and description", () => {
    const tool = SubAgent.create({
      name: "researcher",
      description: "Researches a topic",
      instructions: "You are a researcher.",
    });
    expect(tool.name).toBe("researcher");
    expect(tool.description).toBe("Researches a topic");
    expect(tool.inputSchema).toBeDefined();
    expect(typeof tool.handler).toBe("function");
  });

  it("creates child agent and returns final text", async () => {
    const mockDispose = vi.fn();
    const mockSend = vi
      .fn()
      .mockResolvedValue({ wait: () => Promise.resolve({ result: "research result" }) });
    const mockCreate = vi.fn().mockResolvedValue({
      send: mockSend,
      dispose: mockDispose,
    });

    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: mockCreate },
    }));

    const tool = SubAgent.create({
      name: "researcher",
      description: "Researches",
      instructions: "Research this.",
    });

    const result = await tool.handler({ input: "quantum computing" });
    expect(result).toContain("research result");
  });

  it("disposes child agent after completion", async () => {
    const mockDispose = vi.fn();
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "done" }) }),
          dispose: mockDispose,
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("send failed")) }),
          dispose: mockDispose,
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "" }) }),
          dispose: vi.fn(),
        }),
      },
    }));

    const tool = SubAgent.create({
      name: "empty",
      description: "Handles empty",
      instructions: "Handle it.",
    });
    const result = await tool.handler({ input: "" });
    expect(result).toBe("");
  });

  it("returns (no response) when finalText is undefined", async () => {
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: undefined }) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    const controller = new AbortController();
    await tool.handler({ input: "task" }, { signal: controller.signal });

    // The parent run's AbortSignal must reach the child so aborting the parent
    // cancels the in-flight subagent at its next step.
    expect(mockSend).toHaveBeenCalledWith("task", { signal: controller.signal });
  });

  it("omits signal when invoked without ctx (SE10 — single-arg back-compat)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    await tool.handler({ input: "task" });

    // No ctx ⇒ no signal option: exactly the pre-SE10 call shape.
    expect(mockSend).toHaveBeenCalledWith("task");
  });

  it("omits signal when ctx is present but ctx.signal is undefined (SE10 — undefined-signal edge)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    // ctx present, signal absent (e.g. a run started without an AbortSignal) →
    // the `ctx?.signal !== undefined` guard must fall through to the no-option path.
    await tool.handler({ input: "task" }, { context: { something: true } });

    expect(mockSend).toHaveBeenCalledWith("task");
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
  it("onDelegationStart proceed:false short-circuits with rejectionReason (child never runs)", async () => {
    const mockCreate = vi.fn();
    vi.doMock("../../src/agent.js", () => ({ Agent: { create: mockCreate } }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: (c) => ({ proceed: true, modifiedInput: `${c.input}\n\nFocus on 2025.` }),
    });
    await tool.handler({ input: "research" });

    expect(mockSend).toHaveBeenCalledWith("research\n\nFocus on 2025.");
  });

  it("onDelegationStart modifiedMaxSteps caps the child via maxIterations (SE13)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true, modifiedMaxSteps: 3 }),
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("task", { maxIterations: 3 });
  });

  it("modifiedMaxSteps composes with the forwarded signal on one child send (SE13 + SE10)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

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
    });
  });

  it("modifiedInput and modifiedMaxSteps combine independently (SE13 + SE11)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true, modifiedInput: "rewritten", modifiedMaxSteps: 4 }),
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("rewritten", { maxIterations: 4 });
  });

  it("modifiedMaxSteps applies without an explicit proceed (proceed defaults to allow) (SE13)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ modifiedMaxSteps: 2 }), // no explicit proceed ⇒ not rejected
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("task", { maxIterations: 2 });
  });

  it("onDelegationComplete feedback is appended to the child result", async () => {
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "findings" }) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: () => ({ proceed: true }),
    });
    await tool.handler({ input: "original" });

    expect(mockSend).toHaveBeenCalledWith("original");
  });

  it("awaits an async onDelegationStart hook (modifiedInput via Promise)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      onDelegationStart: async (c) => ({ proceed: true, modifiedInput: `async:${c.input}` }),
    });
    await tool.handler({ input: "task" });

    expect(mockSend).toHaveBeenCalledWith("async:task");
  });

  it("a throwing onDelegationStart propagates (never swallowed)", async () => {
    const mockCreate = vi.fn();
    vi.doMock("../../src/agent.js", () => ({ Agent: { create: mockCreate } }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("child boom")) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({ Agent: { create: mockCreate } }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("boom")) }),
          dispose: vi.fn(),
        }),
      },
    }));

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
  it("messageFilter forwards the filtered parent transcript to the child as context", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      messageFilter: ({ messages }) => messages.filter((m) => m.role === "user"),
    });
    await tool.handler(
      { input: "summarize" },
      {
        messages: [
          { role: "user", content: "hello there" },
          { role: "assistant", content: "assistant reply" },
        ],
      },
    );

    const sent = mockSend.mock.calls[0]?.[0] as string;
    expect(sent).toContain("hello there"); // forwarded user turn
    expect(sent).not.toContain("assistant reply"); // filtered out
    expect(sent).toContain("summarize"); // the task itself
  });

  it("without messageFilter the child receives input only (isolation default)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    // A transcript is available on ctx, but with no messageFilter it is NOT forwarded.
    await tool.handler(
      { input: "task" },
      { messages: [{ role: "user", content: "prior history" }] },
    );

    expect(mockSend).toHaveBeenCalledWith("task");
  });

  it("messageFilter can drop a confidential message from the child context", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      messageFilter: ({ messages }) => messages.filter((m) => !m.content.includes("confidential")),
    });
    await tool.handler(
      { input: "task" },
      {
        messages: [
          { role: "user", content: "public info" },
          { role: "user", content: "confidential secret" },
        ],
      },
    );

    const sent = mockSend.mock.calls[0]?.[0] as string;
    expect(sent).toContain("public info");
    expect(sent).not.toContain("confidential secret");
  });

  it("a throwing messageFilter propagates (fail-fast, never swallowed)", async () => {
    const mockCreate = vi.fn();
    vi.doMock("../../src/agent.js", () => ({ Agent: { create: mockCreate } }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      messageFilter: () => {
        throw new Error("filter boom");
      },
    });
    await expect(
      tool.handler({ input: "task" }, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("filter boom");
    expect(mockCreate).not.toHaveBeenCalled(); // filter throws before the child is created
  });

  it("includeToolResults appends the child's completed tool results (SE14)", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      wait: () => Promise.resolve({ result: "final answer" }),
      // SE14 — run.stream() replays buffered events post-wait; two tool_call events
      // (running then completed) — only the completed one carries a result.
      stream: async function* () {
        yield { type: "tool_call", status: "running", name: "search", args: {} };
        yield { type: "tool_call", status: "completed", name: "search", result: "found it" };
      },
    });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      includeToolResults: true,
    });
    const result = await tool.handler({ input: "task" });

    expect(result).toContain("final answer"); // the text is still there
    expect(result).toContain("search"); // the tool name
    expect(result).toContain("found it"); // the completed tool result
  });

  it("without includeToolResults the result is text-only, stream not consumed (SE14 default)", async () => {
    const streamSpy = vi.fn();
    const mockSend = vi.fn().mockResolvedValue({
      wait: () => Promise.resolve({ result: "final answer" }),
      stream: () => {
        streamSpy();
        return (async function* () {})();
      },
    });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    const result = await tool.handler({ input: "task" });

    expect(result).toBe("final answer"); // text-only, no tool-results block
    expect(streamSpy).not.toHaveBeenCalled(); // default never touches the stream
  });

  it("includeToolResults JSON-stringifies a non-string tool result (SE14)", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      wait: () => Promise.resolve({ result: "final" }),
      stream: async function* () {
        yield {
          type: "tool_call",
          status: "completed",
          name: "run_cmd",
          result: { stdout: "ok", exitCode: 0 },
        };
      },
    });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      includeToolResults: true,
    });
    const result = await tool.handler({ input: "task" });

    expect(result).toContain('{"stdout":"ok","exitCode":0}'); // object rendered via JSON.stringify
    expect(result).toContain("run_cmd");
  });

  it("includeToolResults: a throwing stream propagates and still disposes the child (SE14)", async () => {
    const mockDispose = vi.fn();
    const mockSend = vi.fn().mockResolvedValue({
      wait: () => Promise.resolve({ result: "final" }),
      stream: async function* () {
        // yield one (skipped) event, then throw mid-drain to exercise the error path.
        yield { type: "tool_call", status: "running", name: "x", args: {} };
        throw new Error("stream boom");
      },
    });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: mockDispose }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      includeToolResults: true,
    });
    await expect(tool.handler({ input: "task" })).rejects.toThrow("stream boom");
    expect(mockDispose).toHaveBeenCalledOnce(); // finally disposes even when the drain throws
  });

  it("includeToolResults with no completed tool calls stays text-only (SE14)", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      wait: () => Promise.resolve({ result: "just text" }),
      stream: async function* () {
        // an assistant-only run — no tool_call events
      },
    });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      includeToolResults: true,
    });
    const result = await tool.handler({ input: "task" });

    expect(result).toBe("just text"); // no tool results ⇒ no appended block
  });

  it("messageFilter returning an empty subset sends input only (no empty preamble)", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }) },
    }));

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      messageFilter: () => [],
    });
    await tool.handler({ input: "task" }, { messages: [{ role: "user", content: "history" }] });

    expect(mockSend).toHaveBeenCalledWith("task");
  });
});
