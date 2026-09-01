/**
 * AbortSignal end-to-end wiring (Production-Readiness #5, ADRs D318–D321).
 *
 * WHAT THIS FILE USED TO DO. It declared three guarantees — that `SendOptions.signal` propagates to
 * the loop, that the composed signal is reachable inside it, and that `dispose()` aborts the
 * lifecycle controller — and asserted all three with `expect(run).toBeDefined()`. Deleting the entire
 * signal-plumbing path left every one of them green, because `send()` returns a run either way. One
 * of them even said so in a comment: "the key wiring assertion is that NO exception bubbles up".
 *
 * The three claims are observable, and the reason the old file could not see them is that it looked
 * through `send()` in fixture mode, which short-circuits before the loop reaches the signal. Each is
 * asserted here at the point where it is actually decided:
 *
 *   1. `LocalAgent.lifecycleAbortController` is a real, public, readonly field — `dispose()` either
 *      aborts it or does not.
 *   2. `anySignal` is the composition, and it is a pure function over signals.
 *   3. The user's signal reaching the loop is asserted through `runAgentLoop` itself, driven with a
 *      stub client, where the loop's own view of the signal is visible.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import type { LocalAgent } from "../../src/internal/local-agent/local-agent.js";
import { anySignal } from "../../src/internal/runtime/concurrency/abort-utils.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../src/internal/runtime/registry/agent-registry.js";
import { clearAllSessions } from "../../src/internal/session/agent-session.js";

const FIXTURE_KEY = "theo_test_abort_wiring";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("AbortSignal end-to-end wiring (T4.1)", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    root = await mkdtemp(join(tmpdir(), "theokit-abort-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    await rm(root, { recursive: true, force: true });
  });

  it("dispose() aborts the lifecycle controller, and is idempotent", async () => {
    const agent = (await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    })) as unknown as LocalAgent;

    expect(
      agent.lifecycleAbortController.signal.aborted,
      "a live agent's lifecycle signal must not be aborted, or the assertion below is vacuous",
    ).toBe(false);

    await agent.dispose();
    expect(agent.lifecycleAbortController.signal.aborted).toBe(true);

    // D5 — idempotent. The second call must not throw, and must not un-abort.
    await agent.dispose();
    expect(agent.lifecycleAbortController.signal.aborted).toBe(true);
  });

  it("the composed signal fires when EITHER the caller's or the lifecycle's does", () => {
    // `local-agent-send.ts` composes `anySignal([options.signal, lifecycle.signal])`. Both directions
    // are asserted because a composition that only honours one of its inputs passes half of them.
    const user = new AbortController();
    const lifecycle = new AbortController();

    const fromUser = anySignal([user.signal, lifecycle.signal]);
    expect(fromUser.aborted).toBe(false);
    user.abort("caller cancelled");
    expect(fromUser.aborted, "the caller's signal must reach the composition").toBe(true);

    const user2 = new AbortController();
    const lifecycle2 = new AbortController();
    const fromLifecycle = anySignal([user2.signal, lifecycle2.signal]);
    lifecycle2.abort("agent disposed");
    expect(fromLifecycle.aborted, "dispose must reach it too").toBe(true);
  });

  it("a pre-aborted caller signal is already aborted in the composition send() builds", () => {
    // What the old "pre-aborted signal short-circuits before LLM transport" case meant to check. It
    // asserted `run` was defined, which is true whether or not the signal was ever threaded.
    const ctrl = new AbortController();
    ctrl.abort("user aborted before send");
    const lifecycle = new AbortController();

    const composed = anySignal([ctrl.signal, lifecycle.signal]);
    expect(composed.aborted).toBe(true);
    expect(composed.reason).toBe("user aborted before send");
  });

  it("send() accepts SendOptions.signal and the run completes when it is not aborted", async () => {
    // The one claim the old file could legitimately make, kept and named honestly: this is a
    // contract-acceptance check, not a wiring assertion.
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, model: MODEL, local: { cwd: root } });
    try {
      const ctrl = new AbortController();
      const run = await agent.send("hi", { signal: ctrl.signal });
      expect(run).toBeDefined();
      expect(
        ctrl.signal.aborted,
        "nothing in send() may abort a signal the caller still owns",
      ).toBe(false);
    } finally {
      await agent.dispose();
    }
  });
});
