import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";

/**
 * M91 — o docstring de `getOrCreate` afirmava o oposto do comportamento real.
 *
 * Ele dizia: *"Disposed agents are NOT auto-deleted from the registry. To force a fresh agent, call
 * `Agent.delete(agentId)` first."* Measured, that is false: `dispose()` calls `liveAgentRegistry.forget(id)`,
 * so the next `getOrCreate(id)` builds a fresh handle.
 *
 * The claim was about the PERSISTENT registry and was read as being about the live cache — and consumers
 * built on the wrong half. The agent-builder rotates the session id on M85's interruption
 * to work around a restriction that does not exist.
 *
 * This file exists so the docstring's correction does not diverge from the code again.
 */
describe("M91 — getOrCreate depois de dispose", () => {
  const opts = {
    apiKey: "sk-test",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
  };

  it("cache-hit VIVO devolve a mesma instancia", async () => {
    const a = await Agent.getOrCreate("m91-vivo", opts as never);
    const b = await Agent.getOrCreate("m91-vivo", opts as never);
    expect(b).toBe(a);
    await a.dispose();
  });

  it("depois de dispose, getOrCreate devolve instancia NOVA — sem Agent.delete manual", async () => {
    const a = await Agent.getOrCreate("m91-disp", opts as never);
    await a.dispose();
    const b = await Agent.getOrCreate("m91-disp", opts as never);
    expect(b).not.toBe(a);
    await b.dispose();
  });
});
