/**
 * runToCompletion wiring test (M1 Phase 3 — wiring triad pillar a + b).
 *
 * Verifies `LocalAgent.runToCompletion()` is wired end-to-end: the public
 * method resolves through `local-agent-runtime-extensions.ts` →
 * `runToCompletionImpl` → the agent's own `send()`. Uses fixture mode so no
 * real LLM is called.
 *
 * Fixture mode never sets `stoppedAtIterationLimit`, so the first round is a
 * clean finish — the driver returns `terminal: "done"`, `rounds: 0` after a
 * single real `send`. That is exactly the integration the unit test
 * (`run-to-completion.test.ts`) mocks: here it crosses the real class boundary.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { UnsupportedRunOperationError } from "../src/errors.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// This file creates agents without naming a cwd — `local: {}` and an omitted `local` both fall
// back to process.cwd(), which during a test run is the package itself, so the sessions landed
// in packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

describe("LocalAgent.runToCompletion wiring (M1 Phase 3)", () => {
  it("method exists and drives a real send to a done terminal", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_run_to_completion",
      model: { id: "openai/gpt-4o-mini" },
      local: {},
    });

    expect(typeof agent.runToCompletion).toBe("function");

    const out = await agent.runToCompletion?.("do the task");
    expect(out?.terminal).toBe("done");
    expect(out?.rounds).toBe(0);
    expect(typeof out?.lastResult.id).toBe("string");

    await agent.dispose();
  });

  it("cloud agents throw UnsupportedRunOperationError", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_run_to_completion_cloud",
      model: { id: "openai/gpt-4o-mini" },
      cloud: {},
    });

    // Synchronous throw (mirrors CloudAgent.runUntil/fork), not a rejected promise.
    expect(() => agent.runToCompletion?.("do the task")).toThrow(UnsupportedRunOperationError);

    await agent.dispose();
  });
});
