import { afterEach, expect, it, vi } from "vitest";
import { MaxDelegationDepthError, SubAgent } from "../../src/a2a/subagent.js";
import type { AgentFacadePort } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import { setAgentFacade } from "../../src/internal/runtime/registry/agent-factory-registry.js";
import type { CustomTool } from "../../src/types/agent.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/*
 * #364 — `maxDelegationDepth` could not fire through any supported call.
 *
 * The check ran once at TOOL-CONSTRUCTION time against a caller-supplied `_parentDepth` that
 * nothing in the SDK ever incremented. With `SubAgent.create(spec)` the test was `1 > maxDepth`,
 * false for every spec that did not ask for depth 0, so a subagent whose tools include another
 * subagent recursed unbounded — the exact scenario the docblock claims to prevent.
 *
 * The only path that tripped it was a caller threading the number by hand, which is what the
 * existing suite did, and why the guard read as covered.
 */

/**
 * A facade whose child run dispatches the child's OWN first tool — the shape of a real nesting
 * chain, where each delegation happens inside its parent's dispatch. `depth` is not threaded
 * anywhere: the runtime is what must know it.
 */
function installRecursingFacade(): { delegations: () => number } {
  let delegations = 0;
  // Only `create` is exercised by delegation; the rest of the port is not part of this path.
  const facade = {
    create: async (options: { tools?: unknown }) => {
      const tools = (options.tools ?? []) as CustomTool[];
      return {
        send: async () => {
          delegations += 1;
          // Depth is bounded by the guard under test. This ceiling only stops the test process
          // from recursing forever when the guard is broken — it is not the assertion.
          if (delegations > 25) throw new Error("runaway delegation");
          const child = tools[0];
          if (child !== undefined) await child.handler({ input: "go deeper" });
          return {
            wait: async () => ({ status: "completed" as const, result: "done" }),
            stream: async function* () {},
          };
        },
        dispose: () => undefined,
      } as unknown as Awaited<ReturnType<AgentFacadePort["create"]>>;
    },
  } as unknown as AgentFacadePort;
  setAgentFacade(facade);
  return { delegations: () => delegations };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("bounds a nested delegation chain built the supported way", async () => {
  installRecursingFacade();

  // `leaf` is the tool `mid` delegates to and `mid` is the tool `outer` delegates to, so invoking
  // `outer` walks outer -> mid -> leaf -> mid -> leaf ... Nothing threads a depth by hand; this is
  // the plain `SubAgent.create(spec)` call the README documents.
  const leaf: CustomTool = SubAgent.create({
    name: "leaf",
    description: "d",
    instructions: "i",
    maxDelegationDepth: 2,
  });
  const mid = SubAgent.create({
    name: "mid",
    description: "d",
    instructions: "i",
    tools: [leaf],
    maxDelegationDepth: 2,
  });
  const outer = SubAgent.create({
    name: "outer",
    description: "d",
    instructions: "i",
    tools: [mid],
    maxDelegationDepth: 2,
  });

  await expect(outer.handler({ input: "start" })).rejects.toBeInstanceOf(MaxDelegationDepthError);
});

it("still allows a chain that stays within the declared depth", async () => {
  // The accepted case (`testing.md` § 4.2). A guard that rejected every delegation would satisfy
  // the test above while making the feature useless.
  const { delegations } = installRecursingFacade();

  const leaf = SubAgent.create({ name: "leaf", description: "d", instructions: "i" });
  const outer = SubAgent.create({
    name: "outer",
    description: "d",
    instructions: "i",
    tools: [leaf],
    maxDelegationDepth: 3,
  });

  await expect(outer.handler({ input: "start" })).resolves.toBe("done");
  expect(delegations()).toBeGreaterThan(0);
});

it("a single un-nested delegation is never blocked by the default depth", async () => {
  // The most common call in the wild: one supervisor, one subagent, no `maxDelegationDepth`.
  const { delegations } = installRecursingFacade();

  const solo = SubAgent.create({ name: "solo", description: "d", instructions: "i" });
  await expect(solo.handler({ input: "start" })).resolves.toBe("done");
  expect(delegations()).toBe(1);
});
