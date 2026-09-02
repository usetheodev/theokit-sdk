import { readFileSync } from "node:fs";
/**
 * The SubAgent tool itself: what `SubAgent.create` returns, and what a delegation carries.
 *
 * SPLIT 2026-09-02. This file was 1082 lines under two describe headers, covering the tool shape,
 * credential inheritance, model precedence, plugin inheritance, disposal, depth limits, the
 * delegation hooks and the context filters — seven concerns with seven reasons to change. Its ~50
 * tests were individually well-named and well-scoped; the problem was the file. Siblings named
 * `-depth`, `-credentials-*` had already started the split.
 */
import { describe, expect, it, vi } from "vitest";
import { SubAgent } from "../../src/a2a/subagent.js";
import { withInheritedSubAgentCredentials } from "../../src/internal/concurrency/subagent-credentials.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import type { CustomTool } from "../../src/types/agent.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

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
});
