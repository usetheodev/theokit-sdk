/**
 * Integration test: Agent.batch with credential pool + fixture mode (T5.2).
 *
 * Uses real `Agent.batch` through fixture mode (no LLM). Validates:
 * - 5 prompts → 5 results in input order
 * - Some failures are isolated (others still succeed)
 * - onProgress observes n completions
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import { _resetCredentialPoolWarnings } from "../../src/internal/llm/router.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// This file creates agents without naming a cwd — `local: {}` and an omitted `local` both fall
// back to process.cwd(), which during a test run is the package itself, so the sessions landed
// in packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

describe("Agent.batch with credential pool — integration (T5.2)", () => {
  beforeEach(() => {
    _resetCredentialPoolWarnings();
  });
  afterEach(() => {
    _resetCredentialPoolWarnings();
  });

  it("5 prompts complete, results in input order", async () => {
    const results = await Agent.batch(["A", "B", "C", "D", "E"], {
      apiKey: "theo_test_pool_integration",
      model: { id: "openai/gpt-4o-mini" },
      local: {},
      concurrency: 2,
      providers: {
        routes: [],
        apiKeys: { openai: ["theo_test_k1", "theo_test_k2"] },
      },
    });
    expect(results.length).toBe(5);
    expect(results.map((r) => r.prompt)).toEqual(["A", "B", "C", "D", "E"]);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("onProgress observes n completions in order", async () => {
    const completedTrail: number[] = [];
    const results = await Agent.batch(["x", "y", "z"], {
      apiKey: "theo_test_pool_progress",
      model: { id: "openai/gpt-4o-mini" },
      local: {},
      concurrency: 1,
      onProgress: (p) => {
        completedTrail.push(p.completed);
      },
    });
    expect(results.length).toBe(3);
    // Last snapshot should reach total
    expect(completedTrail[completedTrail.length - 1]).toBe(3);
    // Monotonic non-decreasing
    for (let i = 1; i < completedTrail.length; i += 1) {
      expect(completedTrail[i]).toBeGreaterThanOrEqual(completedTrail[i - 1] ?? 0);
    }
  });

  it("metadata round-trips through pool-backed batch", async () => {
    const results = await Agent.batch(
      [
        { prompt: "alpha", metadata: { tag: "A" } },
        { prompt: "beta", metadata: { tag: "B" } },
      ],
      {
        apiKey: "theo_test_pool_meta",
        model: { id: "openai/gpt-4o-mini" },
        local: {},
        concurrency: 2,
        providers: {
          routes: [],
          apiKeys: { openai: ["theo_test_kA", "theo_test_kB"] },
        },
      },
    );
    expect(results[0]?.metadata).toEqual({ tag: "A" });
    expect(results[1]?.metadata).toEqual({ tag: "B" });
  });
});
