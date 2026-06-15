/**
 * Tests for createCrew — sequential multi-agent team (cross-val Gap 1, narrowed).
 *
 * createCrew is a THIN convenience that COMPOSES Workflow + agentStep (no new
 * orchestration engine). It runs agents in order, threading each agent's
 * output into the next agent's prompt.
 */

import { describe, expect, it } from "vitest";
import { createCrew } from "../src/crew.js";
import { ConfigurationError } from "../src/errors.js";
import type { SDKAgent } from "../src/types/agent.js";

/**
 * Fake agent: records the prompt it received, returns `${prompt}>${tag}` so a
 * threaded chain is observable in the final output.
 */
function fakeAgent(tag: string, seen: string[]): SDKAgent {
  return {
    agentId: `fake-${tag}`,
    async send(message: string | { text: string }) {
      const prompt = typeof message === "string" ? message : message.text;
      seen.push(prompt);
      return {
        wait: async () => ({
          id: `run-${tag}`,
          status: "finished" as const,
          result: `${prompt}>${tag}`,
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      };
    },
  } as unknown as SDKAgent;
}

describe("createCrew — sequential threading", () => {
  it("test_createCrew_runs_agents_sequentially_threading_output", async () => {
    const seen: string[] = [];
    const crew = createCrew({
      agents: [fakeAgent("a", seen), fakeAgent("b", seen), fakeAgent("c", seen)],
    });
    const run = await crew.run("start");
    // a sees "start"; b sees a's output "start>a"; c sees "start>a>b".
    expect(seen).toEqual(["start", "start>a", "start>a>b"]);
    expect(run.result).toBe("start>a>b>c");
    expect(run.status).toBe("completed");
  });

  it("test_createCrew_returns_per_agent_trace", async () => {
    const seen: string[] = [];
    const crew = createCrew({ agents: [fakeAgent("a", seen), fakeAgent("b", seen)] });
    const run = await crew.run("go");
    expect(run.steps).toHaveLength(2);
    expect(run.steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("test_default_process_is_sequential", async () => {
    const seen: string[] = [];
    const crew = createCrew({ agents: [fakeAgent("a", seen)] }); // no process specified
    const run = await crew.run("x");
    expect(run.result).toBe("x>a");
  });
});

describe("createCrew — validation (fail-fast)", () => {
  it("test_rejects_empty_agents", () => {
    expect(() => createCrew({ agents: [] })).toThrowError(ConfigurationError);
    try {
      createCrew({ agents: [] });
    } catch (e) {
      expect((e as ConfigurationError).code).toBe("invalid_crew");
    }
  });

  it("test_rejects_hierarchical_with_guidance", () => {
    const seen: string[] = [];
    expect(() =>
      createCrew({ agents: [fakeAgent("a", seen)], process: "hierarchical" }),
    ).toThrowError(ConfigurationError);
    try {
      createCrew({ agents: [fakeAgent("a", seen)], process: "hierarchical" });
    } catch (e) {
      expect((e as ConfigurationError).code).toBe("crew_process_unsupported");
      // guidance points to the existing delegation primitives
      expect((e as Error).message.toLowerCase()).toMatch(/subagent|handoff/);
    }
  });
});
