/**
 * Agent.batch wiring test (T4.1).
 *
 * Verifies the static façade actually routes to batchImpl. Uses fixture mode
 * so no real LLM is called — we only assert the wiring resolves an array,
 * matches input length, and preserves order.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// This file creates agents without naming a cwd — `local: {}` and an omitted `local` both fall
// back to process.cwd(), which during a test run is the package itself, so the sessions landed
// in packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

describe("Agent.batch wiring (T4.1)", () => {
  it("static method exists and returns array of correct length", async () => {
    const results = await Agent.batch(["a", "b", "c"], {
      apiKey: "theo_test_batch_wiring",
      model: { id: "openai/gpt-4o-mini" },
      local: {},
      concurrency: 2,
    });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3);
    // Order preserved
    expect(results.map((r) => r.prompt)).toEqual(["a", "b", "c"]);
    // Indexes contiguous
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("empty array returns empty without creating agents (EC-1)", async () => {
    const results = await Agent.batch([], {
      apiKey: "theo_test_empty",
      model: { id: "openai/gpt-4o-mini" },
      local: {},
    });
    expect(results).toEqual([]);
  });

  it("BatchItem with metadata round-trips (EC-12)", async () => {
    const results = await Agent.batch(
      [
        { prompt: "first", metadata: { tag: "x" } },
        { prompt: "second", metadata: { tag: "y" } },
      ],
      {
        apiKey: "theo_test_batch_meta",
        model: { id: "openai/gpt-4o-mini" },
        local: {},
      },
    );
    expect(results.length).toBe(2);
    expect(results[0]?.metadata).toEqual({ tag: "x" });
    expect(results[1]?.metadata).toEqual({ tag: "y" });
  });
});
