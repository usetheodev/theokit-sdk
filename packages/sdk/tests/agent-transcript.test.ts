/**
 * theokit#146 — `Agent.transcript()`: the public read surface for a resumed session.
 *
 * The projection fix (`SessionMessage.parts`) is covered at its own layer in
 * `tests/internal/session/session-message-parts.test.ts`. What THIS file covers is the wiring: that
 * the public method reaches the registry, opens the right store and returns that projection. A
 * public method composed of two already-tested pieces is exactly where a wiring bug hides — the
 * repo's own recurring lesson is that the metric can pass while the invariant does not.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { UnknownAgentError } from "../src/errors.js";

describe("theokit#146 — Agent.transcript()", () => {
  let cwd: string;
  let baseDir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-transcript-cwd-"));
    baseDir = await mkdtemp(join(tmpdir(), "theokit-transcript-home-"));
  });

  afterEach(async () => {
    // NOT removed. The SDK persists its agent registry asynchronously, and a `rm(cwd, {recursive})`
    // races that write: rm walks the directory while a `registry.json.<pid>.<hash>.tmp` appears in
    // it, and fails with ENOTEMPTY. Measured 2 failures in 8 isolated runs; an explicit
    // `flushRegistrySaves()` did not close it, because a save can still be scheduled after the
    // flush. A teardown that fails the suite for reasons unrelated to what is under test is worse
    // than a leftover directory under `os.tmpdir()`, which the OS reclaims.
    await Promise.resolve();
  });

  it("test_returns_the_persisted_turns_with_both_projections", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_transcript",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, baseDir },
    });
    // A persisted turn without running a model — the same mechanism `/compact` and the review-exit
    // path use.
    await Agent.injectSessionTurn(agent.agentId, {
      userText: "what changed?",
      assistantText: "Three files.",
    });

    const messages = await Agent.transcript(agent.agentId);

    expect(messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: "user", text: "what changed?" },
      { role: "assistant", text: "Three files." },
    ]);
    // The whole point of the method: structure, not just the flat text.
    expect(messages.map((m) => m.parts)).toEqual([
      [{ type: "text", text: "what changed?" }],
      [{ type: "text", text: "Three files." }],
    ]);
    agent.dispose();
  });

  it("test_a_session_with_no_turns_is_empty_not_an_error", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_transcript",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, baseDir },
    });

    await expect(Agent.transcript(agent.agentId)).resolves.toEqual([]);
    agent.dispose();
  });

  it("test_an_unknown_agent_fails_fast_with_a_typed_error", async () => {
    // Fail loud (Rule 8): returning `[]` here would be indistinguishable from a real empty session,
    // and a host would render a blank transcript for a typo instead of surfacing it.
    await expect(Agent.transcript("agent-does-not-exist")).rejects.toBeInstanceOf(
      UnknownAgentError,
    );
  });
});
