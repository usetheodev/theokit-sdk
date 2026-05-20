import { describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";

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
    // No throw means idempotent. `disposed` flag holds.
    expect(true).toBe(true);
  });

  it("double dispose is idempotent on CloudAgent (EC-3/EC-6)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_double_dispose_cloud",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    await agent.dispose();
    await agent.dispose();
    await agent.dispose();
    expect(true).toBe(true);
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
