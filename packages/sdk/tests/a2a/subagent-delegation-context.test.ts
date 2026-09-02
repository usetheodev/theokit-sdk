/**
 * What of the parent's transcript reaches the child: `messageFilter` and `includeToolResults`.
 *
 * Split out of `subagent-delegation.test.ts` (2026-09-02). One reason to change: the isolation
 * default and the two ways a caller widens it.
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

describe("SubAgent context", () => {
  it("messageFilter forwards the filtered parent transcript to the child as context", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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

    expect(mockSend).toHaveBeenCalledWith("task", { origin: { kind: "coordinator" } });
  });

  it("messageFilter can drop a confidential message from the child context", async () => {
    const mockSend = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: mockDispose }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

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
    setAgentFacade({
      create: vi.fn().mockResolvedValue({ send: mockSend, dispose: vi.fn() }),
    } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "worker",
      description: "Works",
      instructions: "Work.",
      messageFilter: () => [],
    });
    await tool.handler({ input: "task" }, { messages: [{ role: "user", content: "history" }] });

    expect(mockSend).toHaveBeenCalledWith("task", { origin: { kind: "coordinator" } });
  });
});
