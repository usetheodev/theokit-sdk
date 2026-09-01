import { describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";
import * as registry from "../../../src/internal/runtime/registry/agent-registry.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

/**
 * ADR D5 + EC-3 + EC-6 — `await using` works on both runtimes and double
 * dispose is idempotent.
 */

describe("Symbol.asyncDispose support (ADR D5)", () => {
  it("await using disposes LocalAgent exactly once", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_disposable_local",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: process.cwd() },
    });
    const spy = vi.spyOn(agent, "dispose");
    {
      await using held = agent;
      // mute "value never read" for `held` — using-binding intentional.
      expect(held.agentId).toBe(agent.agentId);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("await using disposes CloudAgent exactly once", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_disposable_cloud",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    const spy = vi.spyOn(agent, "dispose");
    {
      await using held = agent;
      expect(held.agentId).toBe(agent.agentId);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("double dispose is idempotent on LocalAgent (EC-6)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_double_dispose_local",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: process.cwd() },
    });
    await agent.dispose();
    await agent.dispose();
    await agent.dispose();

    // B-068. The comment used to say "`disposed` flag holds" and the body never read it — three
    // disposes proving only that nothing threw. Idempotence has two halves and "no throw" is the
    // weaker one: the flag must still be SET after the extra calls, otherwise a second dispose that
    // silently reset it would pass. `send` rejecting is that flag, observed through the public API.
    await expect(
      agent.send("anything"),
      "after repeated dispose the agent must still refuse work",
    ).rejects.toThrow(/dispose/i);
  });

  it("double dispose is idempotent on CloudAgent (EC-3/EC-6)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_double_dispose_cloud",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });

    // B-067 wrote this comment; B-094 retired it. It used to explain why the cloud twin could NOT
    // make the LocalAgent assertion — `CloudAgent` declared `disposed` and `send` never consulted it,
    // so a disposed cloud agent still resolved with a live CloudRun while the local one rejected.
    // That asymmetry is fixed, so the assertion the comment called impossible is now below.
    //
    // The flush count stays: it is a different claim (the teardown work happens once, 1 on current
    // code and 3 with the `if (this.disposed) return;` line removed) and it is still the only oracle
    // for that half of idempotence.
    const flush = vi.spyOn(registry, "flushRegistrySaves");
    try {
      await agent.dispose();
      await agent.dispose();
      await agent.dispose();
      expect(
        flush,
        "repeated dispose must do the teardown work exactly once",
      ).toHaveBeenCalledTimes(1);

      // B-094 — the half that was missing. A disposed handle must refuse work, and it must refuse it
      // the same way the local one does: a typed AgentDisposedError, not a TypeError from a nulled
      // client and not a live run.
      await expect(
        agent.send("anything"),
        "after repeated dispose the cloud agent must refuse work, as the local one does",
      ).rejects.toThrow(/dispose/i);
    } finally {
      flush.mockRestore();
    }
  });

  it("manual dispose still works (no behavioral regression)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_manual_dispose",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: process.cwd() },
    });
    await expect(agent.dispose()).resolves.toBeUndefined();
  });

  it("Symbol.asyncDispose calls dispose (used by `using`)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_symbol_dispose",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: process.cwd() },
    });
    const spy = vi.spyOn(agent, "dispose");
    await agent[Symbol.asyncDispose]();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
