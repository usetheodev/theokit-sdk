import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

/**
 * M91 — the `getOrCreate` docstring claimed the opposite of the real behaviour.
 *
 * It said: *"Disposed agents are NOT auto-deleted from the registry. To force a fresh agent, call
 * `Agent.delete(agentId)` first."* Measured, that is false: `dispose()` calls `liveAgentRegistry.forget(id)`,
 * so the next `getOrCreate(id)` builds a fresh handle.
 *
 * The claim was about the PERSISTENT registry and was read as being about the live cache — and consumers
 * built on the wrong half. The agent-builder rotates the session id on M85's interruption
 * to work around a restriction that does not exist.
 *
 * This file exists so the docstring's correction does not diverge from the code again.
 */
describe("M91 — getOrCreate after dispose", () => {
  const opts = {
    // B-130: this was a short placeholder key against a named `openai/` model. It passed only
    // because the strict shape check was unreachable for every input; with that fixed it is
    // correctly refused as malformed. Switched to the repo's fixture-key convention, which is
    // what this suite always meant — it tests session directories, not authentication.
    apiKey: "theo_test_fixture_key",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
  };

  it("a LIVE cache hit returns the same instance", async () => {
    const a = await Agent.getOrCreate("m91-live", opts as never);
    const b = await Agent.getOrCreate("m91-live", opts as never);
    expect(b).toBe(a);
    await a.dispose();
  });

  it("after dispose, getOrCreate returns a NEW instance — with no manual Agent.delete", async () => {
    const a = await Agent.getOrCreate("m91-disp", opts as never);
    await a.dispose();
    const b = await Agent.getOrCreate("m91-disp", opts as never);
    expect(b).not.toBe(a);
    await b.dispose();
  });
});
