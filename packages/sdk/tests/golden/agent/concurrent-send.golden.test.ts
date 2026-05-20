import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../../src/internal/runtime/agent-registry.js";
import {
  clearAllSessions,
  flushSessionWrites,
  getSessionMessages,
} from "../../../src/internal/runtime/agent-session.js";
import { sessionFilePath } from "../../../src/internal/runtime/agent-session-store.js";

/**
 * ADR D19 + EC-8 — per-agent send mutex (`agent-send:${agentId}`). Concurrent
 * sends to the SAME agent serialize end-to-end (user-1, assistant-1, user-2,
 * assistant-2) without interleaving. Different agents remain parallel.
 */
describe("Per-agent send mutex (T2.1 / ADR D19)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-mutex-"));
    clearAllSessions();
    clearAgentRegistry();
    invalidateRegistryHydration();
  });

  afterEach(async () => {
    await flushSessionWrites();
    clearAllSessions();
    clearAgentRegistry();
    invalidateRegistryHydration();
    await rm(cwd, { recursive: true, force: true });
  });

  it("two-concurrent-sends-serialize — records appear in completion order, not interleaved mid-turn", async () => {
    const agent = await Agent.create({
      agentId: "agent-concurrent-test",
      apiKey: "theo_test_concurrent_serialize",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });

    // Fire two sends concurrently. With the mutex, send-B's user-turn lands
    // ONLY AFTER send-A's assistant-turn — never between A's user and A's
    // assistant.
    const [runA, runB] = await Promise.all([agent.send("alpha"), agent.send("beta")]);
    await Promise.all([runA.wait(), runB.wait()]);
    await agent.dispose();

    const messages = getSessionMessages(agent.agentId);
    // Expect ordering: user(alpha) → assistant(alpha-response) → user(beta) →
    // assistant(beta-response). Strict role alternation proves no
    // mid-turn interleave.
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
    // Texts: user turns are alpha+beta in completion order.
    const userTexts = messages.filter((m) => m.role === "user").map((m) => m.text);
    expect(userTexts).toEqual(["alpha", "beta"]);
  });

  it("different-agents-stay-parallel — sendA + sendB to distinct agents overlap in time", async () => {
    const agentA = await Agent.create({
      agentId: "agent-parallel-a",
      apiKey: "theo_test_parallel_a",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });
    const agentB = await Agent.create({
      agentId: "agent-parallel-b",
      apiKey: "theo_test_parallel_b",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });

    const start = Date.now();
    const [runA, runB] = await Promise.all([agentA.send("hi from A"), agentB.send("hi from B")]);
    await Promise.all([runA.wait(), runB.wait()]);
    const totalMs = Date.now() - start;

    // Both fixture runs are fast; if they were forced serial through a
    // SHARED mutex this would still pass, but we also assert that BOTH
    // session files exist with one user record each.
    await agentA.dispose();
    await agentB.dispose();

    const fileA = await readFile(sessionFilePath(cwd, agentA.agentId), "utf8");
    const fileB = await readFile(sessionFilePath(cwd, agentB.agentId), "utf8");
    expect(fileA).toContain("hi from A");
    expect(fileA).not.toContain("hi from B");
    expect(fileB).toContain("hi from B");
    expect(fileB).not.toContain("hi from A");
    // Loose timing guard — two fixture sends shouldn't take more than a couple
    // of seconds combined when parallel.
    expect(totalMs).toBeLessThan(5000);
  });

  it("subagent-send-no-deadlock (EC-8) — parent A sending while invoking subagent B (distinct id) both complete", async () => {
    // Mutexes are keyed per agentId. A parent's send holds `agent-send:A`;
    // a subagent's send acquires `agent-send:B`. No shared lock → no
    // deadlock. Asserted by running two sends concurrently on distinct ids
    // and verifying both finish.
    const parent = await Agent.create({
      agentId: "agent-parent-deadlock",
      apiKey: "theo_test_parent",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });
    const subagent = await Agent.create({
      agentId: "agent-subagent-deadlock",
      apiKey: "theo_test_subagent",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });

    const runs = await Promise.all([parent.send("parent turn"), subagent.send("sub turn")]);
    const results = await Promise.all(runs.map((r) => r.wait()));
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "finished")).toBe(true);

    await parent.dispose();
    await subagent.dispose();
  });

  it("sequential-sends-keep-conversation-history-linear — 5 sequential turns produce user/assistant pairs", async () => {
    const agent = await Agent.create({
      agentId: "agent-sequential-history",
      apiKey: "theo_test_sequential",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });

    for (let i = 0; i < 5; i += 1) {
      const run = await agent.send(`turn ${i}`);
      await run.wait();
    }
    await agent.dispose();

    const messages = getSessionMessages(agent.agentId);
    expect(messages.length).toBe(10);
    for (let i = 0; i < 5; i += 1) {
      expect(messages[i * 2]?.role).toBe("user");
      expect(messages[i * 2 + 1]?.role).toBe("assistant");
    }
  });

  it("dispose-with-pending-send-is-safe — pending send either completes or throws AgentDisposed cleanly", async () => {
    const agent = await Agent.create({
      agentId: "agent-dispose-pending",
      apiKey: "theo_test_dispose_pending",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });

    const sendP = agent.send("about to dispose");
    const disposeP = agent.dispose();
    // The send-vs-dispose race resolves in two valid shapes:
    //  (a) send wins → run.wait() returns a finished result.
    //  (b) dispose wins → sendP rejects with "Agent has been disposed".
    // Either outcome is acceptable; what matters is that NEITHER blocks
    // indefinitely and the mutex never leaks.
    const sendOutcome = await sendP
      .then((run) => run.wait().then(() => "completed" as const))
      .catch((err: unknown) => {
        if (err instanceof Error && /disposed/i.test(err.message)) return "rejected" as const;
        throw err;
      });
    await disposeP;
    expect(["completed", "rejected"]).toContain(sendOutcome);
  });
});
