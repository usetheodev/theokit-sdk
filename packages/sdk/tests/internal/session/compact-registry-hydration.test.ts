import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent, UnknownAgentError } from "../../../src/index.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../../src/internal/runtime/registry/agent-registry.js";

/**
 * B-016 — regression cover for cc1c3f7e, the fourth of the four provider-resolution fixes that
 * shipped with no test: `Agent.compact` on a registry MISS must hydrate the per-cwd registry from
 * disk (D21) before concluding the agent does not exist.
 *
 * The scenario is a fresh process — a TUI `/compact` issued before any turn has run, so nothing has
 * populated the in-memory Map. Without the hydration step the call throws `UnknownAgentError` for an
 * agent that is sitting on disk. `Agent.compact` reads `process.cwd()` (it has no cwd option), so the
 * test chdirs into its own tmpdir for the duration, following
 * `tests/golden/runtime/agent-registry-persistence.golden.test.ts`.
 */
describe("Agent.compact — registry hydration on a miss (D21, cc1c3f7e)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-compact-hydrate-"));
    clearAgentRegistry();
    invalidateRegistryHydration();
  });

  afterEach(async () => {
    clearAgentRegistry();
    invalidateRegistryHydration();
    await rm(cwd, { recursive: true, force: true });
  });

  it("compacts an agent that exists only on disk, after the in-memory registry was wiped", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_compact_hydrate",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });
    const agentId = agent.agentId;
    await agent.dispose();

    // Simulate the fresh process: in-memory Map empty, the entry persists on disk only.
    clearAgentRegistry();
    invalidateRegistryHydration();

    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      const result = await Agent.compact(agentId, {
        trigger: "manual",
        summarize: async () => "a deterministic summary",
      });
      expect(result).toMatchObject({
        preTokens: expect.any(Number),
        postTokens: expect.any(Number),
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  // The accepting half above proves hydration happens; this one proves it is a LOOKUP and not an
  // unconditional success — an agent absent from memory AND from disk must still fail fast.
  it("still throws UnknownAgentError when the agent is on neither the map nor the disk", async () => {
    const previousCwd = process.cwd();
    process.chdir(cwd);
    try {
      await expect(
        Agent.compact("agent-never-created-b016", {
          trigger: "manual",
          summarize: async () => "unused",
        }),
      ).rejects.toBeInstanceOf(UnknownAgentError);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
