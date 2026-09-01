/**
 * theokit#148 (RED-first) — credential inheritance must survive a NORMALIZED tool object.
 *
 * The recurring class (#142, #143, #148): the parent's credentials reach a subagent through a
 * property installed on the tool OBJECT. Any layer that rebuilds that object drops the property,
 * and the child then fails with `provider_unresolved` — surfacing to a user as "(no response)".
 *
 * That is not hypothetical. `@theokit/agents` lowers every tool through `toCompiledTool`, which
 * constructs a fresh object from four known fields. It only works today because it also runs an
 * explicit `Object.getOwnPropertySymbols` copy loop — a band-aid the SDK's own contract forced on a
 * consumer, and one a NAMED field would defeat just as thoroughly as the symbol it rescues.
 *
 * So the invariant under test is deliberately stated without reference to any property: a subagent
 * tool that has been rebuilt from its four public fields, with every extra own property (string AND
 * symbol) discarded, must still receive the parent's apiKey when the run dispatches it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubAgent } from "../../src/a2a/subagent.js";
import { withInheritedSubAgentCredentials } from "../../src/internal/runtime/concurrency/subagent-credentials.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import type { CustomTool } from "../../src/types/agent.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * Exactly what `@theokit/agents`' `toCompiledTool` does, minus its symbol-copy band-aid: a fresh
 * object carrying the four public fields and nothing else.
 */
function normalizeLikeAFramework(tool: CustomTool): CustomTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: (input, ctx) => tool.handler(input, ctx),
  };
}

describe("theokit#148 — subagent credential inheritance survives tool normalization", () => {
  let created: Array<Record<string, unknown>>;

  beforeEach(() => {
    created = [];
    setAgentFacade({
      create: vi.fn(async (options: Record<string, unknown>) => {
        created.push(options);
        return {
          send: vi.fn(async () => ({ wait: async () => ({ result: "child ok" }) })),
          dispose: vi.fn(),
        };
      }),
    } as unknown as AgentFacadePort);
  });

  it("test_a_rebuilt_subagent_tool_still_inherits_the_parents_apiKey", async () => {
    const tool = SubAgent.create({ name: "researcher", description: "d", instructions: "i" });
    const normalized = normalizeLikeAFramework(tool);

    // Sanity: the rebuild really did discard every channel that rides the object.
    expect(Object.getOwnPropertySymbols(normalized)).toHaveLength(0);
    expect(Object.keys(normalized).sort()).toEqual([
      "description",
      "handler",
      "inputSchema",
      "name",
    ]);

    // The run establishes the parent's credentials for the duration of the loop; the tool is
    // dispatched inside that scope, exactly as `runAgentLoop` dispatches it.
    await withInheritedSubAgentCredentials(
      { apiKey: "theo_parent_key", model: { id: "openai/gpt-4o-mini" } },
      async () => {
        await normalized.handler({ input: "task" });
      },
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      apiKey: "theo_parent_key",
      model: { id: "openai/gpt-4o-mini" },
    });
  });

  it("test_COUNTERPROOF_outside_a_run_scope_no_credentials_are_invented", async () => {
    // The scope must be the ONLY source. A subagent dispatched with no parent context must not
    // silently pick up credentials from a previous run — that would be a cross-tenant leak.
    const tool = SubAgent.create({ name: "researcher", description: "d", instructions: "i" });

    await tool.handler({ input: "task" });

    expect(created).toHaveLength(1);
    expect(created[0]).not.toHaveProperty("apiKey");
  });

  it("test_concurrent_runs_do_not_see_each_others_credentials", async () => {
    // The defect a per-tool-object slot cannot avoid: one shared tool, two parents, last writer
    // wins. Scoped delivery makes each dispatch read its OWN run's credentials.
    const shared = SubAgent.create({ name: "shared", description: "d", instructions: "i" });

    await Promise.all([
      withInheritedSubAgentCredentials({ apiKey: "key-alpha" }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        await shared.handler({ input: "a" });
      }),
      withInheritedSubAgentCredentials({ apiKey: "key-beta" }, async () => {
        await shared.handler({ input: "b" });
      }),
    ]);

    expect(created.map((o) => o.apiKey).sort()).toEqual(["key-alpha", "key-beta"]);
  });
});
