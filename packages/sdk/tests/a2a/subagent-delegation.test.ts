import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  MaxDelegationDepthError,
  SubAgent,
  subAgentToolsFromDefinitions,
} from "../../src/a2a/subagent.js";
import {
  type InheritedCredentials,
  withInheritedSubAgentCredentials,
} from "../../src/internal/runtime/concurrency/subagent-credentials.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import type { CustomTool } from "../../src/types/agent.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * theokit#148 — dispatch a subagent tool the way a run does: inside the parent's credential scope.
 *
 * These tests used to call `inheritSubAgentCredentials(tool, creds)` and then the handler, which
 * exercised a channel that rode the tool object. That channel is gone: any layer rebuilding the
 * object dropped it (including the SDK's own rebuild), so credentials now travel with the call.
 */
async function delegateWithParent(
  tool: CustomTool,
  credentials: InheritedCredentials,
  input: string,
): Promise<unknown> {
  return withInheritedSubAgentCredentials(credentials, async () => tool.handler({ input }));
}

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

  it("exposes a JSON-Schema inputSchema to the LLM (not a raw Zod object)", () => {
    // The LLM receives `tool.inputSchema` verbatim as the tool's parameter schema.
    // A raw Zod object serializes to garbage, so the model emits malformed tool
    // input that fails validation — the delegation then never runs. It must be a
    // real Draft-7 object schema.
    const tool = SubAgent.create({ name: "t", description: "d", instructions: "i" });
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
    });
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

    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "researcher",
      description: "Researches",
      instructions: "Research this.",
    });

    const result = await tool.handler({ input: "quantum computing" });
    expect(result).toContain("research result");
  });

  it("inherits the parent's apiKey and model into the child agent", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
      dispose: vi.fn(),
    });
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({ name: "t", description: "d", instructions: "i" });
    // The parent run publishes its resolved credentials for the duration of the loop.
    await delegateWithParent(
      tool,
      { apiKey: "theo_test_parent", model: { id: "openai/gpt-4o-mini" } },
      "task",
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "theo_test_parent", model: { id: "openai/gpt-4o-mini" } }),
    );
  });

  it("keeps `splitting: true`, which the ALS store's singleton identity depends on — regression #142/#143", () => {
    // The old cross-bundle guard asserted a global `Symbol.for` sink key, and was deleted with the
    // symbol. Its FAILURE MODE was not deleted: `withInheritedSubAgentCredentials` holds a
    // module-level `AsyncLocalStorage`, so if the bundler inlines a copy of that module per public
    // entry, the `.` copy publishes into a store the `./a2a` copy never reads — the #142/#143 shape,
    // reproduced exactly. `tsup.config.ts` already documents `splitting: true` as load-bearing for
    // `TheokitAgentError` identity; it is load-bearing for this too, and nothing asserted it.
    const config = readFileSync(new URL("../../tsup.config.ts", import.meta.url), "utf8");

    expect(config).toMatch(/splitting:\s*true/);
  });

  it("carries NO credential channel on the tool object at all — regression #142/#143/#148", () => {
    // The previous fix pinned a `Symbol.for` key and asserted it was installed. That kept the
    // fragile shape: a channel riding the object, which #148 then lost to a layer that rebuilt the
    // object from its known fields. The invariant now is the absence of any such channel — a tool
    // is four public fields and nothing else, so there is nothing left to drop.
    const tool = SubAgent.create({ name: "t", description: "d", instructions: "i" });

    expect(Object.getOwnPropertySymbols(tool)).toHaveLength(0);
    expect(Object.getOwnPropertyNames(tool).sort()).toEqual([
      "description",
      "handler",
      "inputSchema",
      "name",
    ]);
  });

  it("surfaces a child run error instead of swallowing it to '(no response)' — regression #143", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({
        wait: () => Promise.resolve({ status: "error", error: { message: "provider_unresolved" } }),
      }),
      dispose: vi.fn(),
    });
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({ name: "t", description: "d", instructions: "i" });
    // A child that ends in error must throw (Rule 8), not return the "(no response)" fallback that
    // hid the real failure and made the parent loop on it.
    await expect(tool.handler({ input: "task" })).rejects.toThrow(/provider_unresolved/);
  });

  it("prefers the subagent's explicit model over the inherited one", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
      dispose: vi.fn(),
    });
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({
      name: "t",
      description: "d",
      instructions: "i",
      model: "anthropic/claude-3-5-haiku",
    });
    await delegateWithParent(
      tool,
      { apiKey: "theo_test_parent", model: { id: "openai/gpt-4o-mini" } },
      "task",
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "theo_test_parent",
        model: { id: "anthropic/claude-3-5-haiku" },
      }),
    );
  });

  it("stamps origin {kind:'coordinator'} on the delegated child's send (SE3)", async () => {
    const sendSpy = vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) });
    const mockCreate = vi.fn().mockResolvedValue({ send: sendSpy, dispose: vi.fn() });
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({ name: "t", description: "d", instructions: "i" });
    await tool.handler({ input: "task" });

    // The child's turn is initiated by the coordinating parent — provenance stamped.
    expect(sendSpy).toHaveBeenCalledWith(
      "task",
      expect.objectContaining({ origin: { kind: "coordinator" } }),
    );
  });

  it("inherits the parent's plugins (permission gate) into the child agent (#55)", async () => {
    // Security (#55): arg-level permission rules live in a parent plugin. A
    // delegated child must run under the SAME plugins, or its inner tool calls
    // escape the parent's gate. The child Agent.create must receive them.
    const mockCreate = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
      dispose: vi.fn(),
    });
    setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

    const tool = SubAgent.create({ name: "t", description: "d", instructions: "i" });
    const permissionPlugin = { name: "perm", hooks: {} };
    await delegateWithParent(
      tool,
      {
        apiKey: "theo_test_parent",
        // biome-ignore lint/suspicious/noExplicitAny: minimal plugin stand-in for the wiring assertion.
        plugins: [permissionPlugin as any],
      },
      "task",
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ plugins: [permissionPlugin] }),
    );
  });

  describe("subAgentToolsFromDefinitions (declarative `agents` → delegation tools)", () => {
    it("converts each AgentDefinition into a named delegation tool", () => {
      const tools = subAgentToolsFromDefinitions(
        {
          translator: {
            description: "Translate to French",
            prompt: "Translate English to French.",
          },
          summarizer: { description: "Summarize text", prompt: "Summarize." },
        },
        [],
      );
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["summarizer", "translator"]);
      const translator = tools.find((t) => t.name === "translator");
      expect(translator?.description).toBe("Translate to French");
      expect(typeof translator?.handler).toBe("function");
    });

    it("builds the child with the definition's prompt as instructions", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "Bonjour" }) }),
        dispose: vi.fn(),
      });
      setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

      const tool = subAgentToolsFromDefinitions(
        { translator: { description: "d", prompt: "Translate English to French." } },
        [],
      )[0]!;
      await delegateWithParent(tool, { apiKey: "theo_test_parent" }, "good morning");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "theo_test_parent",
          systemPrompt: "Translate English to French.",
        }),
      );
    });

    it("uses the definition's explicit model, and inherits when it is 'inherit'", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
        dispose: vi.fn(),
      });
      setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

      const explicit = subAgentToolsFromDefinitions(
        { a: { description: "d", prompt: "p", model: { id: "anthropic/claude-3-5-haiku" } } },
        [],
      )[0]!;
      await delegateWithParent(explicit, { apiKey: "k", model: { id: "openai/gpt-4o-mini" } }, "x");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: { id: "anthropic/claude-3-5-haiku" } }),
      );

      mockCreate.mockClear();
      const inheriting = subAgentToolsFromDefinitions(
        { b: { description: "d", prompt: "p", model: "inherit" } },
        [],
      )[0]!;
      await delegateWithParent(
        inheriting,
        { apiKey: "k", model: { id: "openai/gpt-4o-mini" } },
        "x",
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: { id: "openai/gpt-4o-mini" } }),
      );
    });

    it("scopes the child to the whitelisted parent tools (def.tools)", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "ok" }) }),
        dispose: vi.fn(),
      });
      setAgentFacade({ create: mockCreate } as unknown as AgentFacadePort);

      const parentTools = [
        { name: "read_file", description: "", inputSchema: {}, handler: () => "" },
        { name: "write_file", description: "", inputSchema: {}, handler: () => "" },
      ];
      const reader = subAgentToolsFromDefinitions(
        { reader: { description: "d", prompt: "p", tools: ["read_file"] } },
        parentTools,
      )[0]!;
      await delegateWithParent(reader, { apiKey: "k" }, "x");

      const passedTools = mockCreate.mock.calls[0]![0].tools as Array<{ name: string }>;
      expect(passedTools.map((t) => t.name)).toEqual(["read_file"]);
    });
  });

  it("a third-party tool dispatched in a parent scope never sees the parent's key", async () => {
    // Was "inheritSubAgentCredentials is a no-op on a non-subagent tool". The guarantee is the same
    // and now structural rather than conditional: credentials live in a module-private store that
    // only the subagent handler reads. A third-party tool receives its input and `ctx`, and there
    // is no code path that puts a credential in either.
    const seen: unknown[] = [];
    const plainTool: CustomTool = {
      name: "plain",
      description: "d",
      inputSchema: {},
      handler: (input, ctx) => {
        seen.push(input, ctx);
        return "x";
      },
    };

    await withInheritedSubAgentCredentials({ apiKey: "theo_test_parent" }, async () =>
      plainTool.handler({ any: "arg" }, { signal: undefined }),
    );

    expect(JSON.stringify(seen)).not.toContain("theo_test_parent");
  });

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
