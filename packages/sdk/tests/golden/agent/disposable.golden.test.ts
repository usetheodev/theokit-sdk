import { describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";
import * as registry from "../../../src/internal/runtime/registry/agent-registry.js";

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

    // B-067. Same hollow oracle as the LocalAgent case above, but the cloud path cannot use the
    // same fix: repairing it surfaced a real asymmetry, filed as B-094. `CloudAgent` declares
    // `disposed` (cloud-agent.ts:55) but uses it ONLY to short-circuit `dispose()` (:217-218);
    // `send` (:107) never consults it, so a disposed cloud agent still resolves with a CloudRun
    // while the local one rejects. Asserting the LocalAgent behaviour here would fail on `main`
    // for a defect this batch is not fixing.
    //
    // What the guard DOES buy today is that the work behind dispose happens once. Counting the
    // flush is that claim stated as an oracle: it is 1 on the current code and 3 with the
    // `if (this.disposed) return;` line removed.
    const flush = vi.spyOn(registry, "flushRegistrySaves");
    try {
      await agent.dispose();
      await agent.dispose();
      await agent.dispose();
      expect(
        flush,
        "repeated dispose must do the teardown work exactly once",
      ).toHaveBeenCalledTimes(1);
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
