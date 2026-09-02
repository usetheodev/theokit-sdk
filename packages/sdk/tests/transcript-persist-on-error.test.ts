/**
 * M93 T3.1 — the error path persists the partial transcript.
 *
 * ## The defect, with exact evidence
 *
 * `runPostRunLifecycle` had a `catch` around `run.wait()` that called `flushSessionWrites()` and
 * **returned**. The comment said "the mutex still releases via the flushes below" — true, and
 * irrelevant: `persistTurnToTranscript` is called **only later in the same function**, and it is the
 * **only** caller in the whole repository. Nothing had been queued, so the flush drained an
 * **empty** set.
 *
 * A 429 after eight tool calls destroyed the turn **leaving nothing on disk**. Combined with the
 * absent retry on the single-key path — M93's other half — the loss was total: the turn failed, was
 * not retried, and left no trace to resume from.
 *
 * ## B-046 — why this file no longer greps its own source
 *
 * Every test here used to read `post-run-lifecycle.ts` off disk, slice the `catch` block, and assert
 * substrings: `toContain("persistTurnToTranscript")`, `toContain("safeConversation(run)")`,
 * `toContain("flushSessionWrites()")`, and a count of `persistTurnToTranscript(` occurrences. The
 * file said so in its own docstring, which was honest — and still wrong in both directions:
 * renaming any of those three symbols broke four tests with zero behaviour change, while calling
 * `persistTurnToTranscript` with the wrong arguments, or inside a broken `try`, kept all four green.
 *
 * The docstring justified it by saying the lifecycle needs "a real `Run`, a `SessionStore`, a
 * `hooksExecutor`, a `memoryGlue` and a `memoryProvider`". Measured against the code, that is not
 * true of the path under test: the `catch` returns before hooks, memory and the summary are ever
 * reached, so the error path needs a `Run` with `wait()` and `conversation()`, and a `SessionStore`
 * — a two-method port (`types/session-store.ts:34`) that exists precisely to be substituted.
 *
 * So every test below drives the real `runPostRunLifecycle` and reads the store, which is the
 * artefact the defect destroyed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HooksExecutor } from "../src/internal/runtime/hooks/hooks-executor.js";
import { runPostRunLifecycle } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";
import type { ConversationTurn } from "../src/types/conversation.js";
import type { Run, RunResult } from "../src/types/run.js";
import type { SessionRecord, SessionStore } from "../src/types/session-store.js";

/** The injectable store the SE41 seam exists for — records land here instead of on disk. */
function inMemoryStore(): SessionStore & { written: SessionRecord[] } {
  const written: SessionRecord[] = [];
  return {
    written,
    readRecords: async () => written,
    appendRecords: async (_agentId: string, records: readonly SessionRecord[]) => {
      written.push(...records);
    },
  };
}

/** A run that dies inside `wait()` — the 429 after N tool calls — but HAS produced real history. */
function runFailingAfter(partial: readonly ConversationTurn[]): Run {
  return {
    wait: async () => {
      throw new Error("429 rate limited after 8 tool calls");
    },
    conversation: async () => [...partial],
  } as unknown as Run;
}

/** A run that finishes cleanly. */
function runFinishing(result: RunResult, conversation: readonly ConversationTurn[]): Run {
  return {
    id: result.id,
    wait: async () => result,
    conversation: async () => [...conversation],
  } as unknown as Run;
}

/** One completed tool call plus its result — the history a mid-turn failure would discard. */
const EIGHT_TOOL_CALLS_IN: readonly ConversationTurn[] = [
  {
    type: "agentConversationTurn",
    turn: {
      steps: [
        {
          type: "toolCall",
          message: { callId: "call_8", name: "shell", args: { command: "ls /srv" } },
        },
        {
          type: "toolResult",
          message: { callId: "call_8", name: "shell", result: "invoices.csv", isError: false },
        },
      ],
    },
  },
] as readonly ConversationTurn[];

describe("M93 — the error path persists the partial transcript", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-m93-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("a turn that dies in run.wait() still leaves its history in the store", async () => {
    const store = inMemoryStore();

    await runPostRunLifecycle({
      run: runFailingAfter(EIGHT_TOOL_CALLS_IN),
      userText: "list the invoices",
      agentId: "m93-persists",
      workspaceCwd: cwd,
      sessionStore: store,
      model: "claude-sonnet-4-5",
      hooksExecutor: new HooksExecutor(cwd),
    });

    // Before M93 this was 0 — `flushSessionWrites` drained an empty set because the only
    // `persistTurnToTranscript` call sat after the `return` the error took.
    expect(store.written.length, "the error path persisted nothing").toBeGreaterThan(0);
    const asText = JSON.stringify(store.written);
    expect(asText, "the user turn is the minimum that must survive").toContain("list the invoices");
  });

  it("persists the run's OWN partial, not a reconstruction of it", async () => {
    // `safeConversation(run)` returns what the turn actually produced. The distinction is not
    // cosmetic: persisting a reconstructed turn would put history on disk that the model never
    // emitted, and a resume would replay an invented tool result as fact. This asserts the
    // persisted records carry the REAL call and its REAL output, keyed by the run's own callId.
    const store = inMemoryStore();

    await runPostRunLifecycle({
      run: runFailingAfter(EIGHT_TOOL_CALLS_IN),
      userText: "list the invoices",
      agentId: "m93-partial",
      workspaceCwd: cwd,
      sessionStore: store,
      model: "claude-sonnet-4-5",
      hooksExecutor: new HooksExecutor(cwd),
    });

    const asText = JSON.stringify(store.written);
    expect(asText, "the completed tool call must survive").toContain("call_8");
    expect(asText, "and so must its result").toContain("invoices.csv");
  });

  it("a run whose conversation() itself fails degrades to the user turn instead of crashing", async () => {
    // `safeConversation` swallows a throwing `conversation()` and yields `[]`. The property that
    // matters is not the swallow, it is what survives it: the user turn still reaches the store, so
    // a doubly-broken turn still leaves a trace to resume from.
    const store = inMemoryStore();
    const brokenRun = {
      wait: async () => {
        throw new Error("429 rate limited");
      },
      conversation: async () => {
        throw new Error("conversation view unavailable");
      },
    } as unknown as Run;

    await expect(
      runPostRunLifecycle({
        run: brokenRun,
        userText: "list the invoices",
        agentId: "m93-degraded",
        workspaceCwd: cwd,
        sessionStore: store,
        model: "claude-sonnet-4-5",
        hooksExecutor: new HooksExecutor(cwd),
      }),
    ).resolves.toBeUndefined();

    expect(JSON.stringify(store.written)).toContain("list the invoices");
  });

  it("a write failure is reported and does not escape over the turn's own error", async () => {
    // The write must not propagate: the caller is waiting on the PROVIDER's error, not on a disk
    // error stacked on top of it (`error-handling.md`: cleanup never propagates over the original
    // failure). And it must not be silent either — it names the agent and the cause on the
    // diagnostic channel. Both halves are asserted below.
    //
    // B-046 finding, measured while replacing the source-text tests. The deleted test asserted that
    // the lifecycle's `catch` block CONTAINS the string "partial transcript write failed". It does.
    // That branch never runs for this failure: `persistTurnToTranscript` is fire-and-forget — it
    // chains the write and returns synchronously, and its own chain catches the store rejection and
    // logs "session transcript write failed" (`internal/session/agent-session.ts`). Nothing is left
    // to reject into the lifecycle's `try`, so its inner `catch` is unreachable for a store failure,
    // which is the one failure it names. Measured: the string that actually reaches stderr here is
    // `session transcript write failed (m93-writefail): disk full`.
    //
    // This asserts the diagnostic that genuinely arrives rather than the one the source contains —
    // the difference the source-text oracle could not see, and the reason it kept a dead branch
    // looking covered for as long as it stood. The unreachable branch is reported as a finding; the
    // repair is a `src/` change outside this batch.
    const brokenStore: SessionStore = {
      readRecords: async () => [],
      appendRecords: async () => {
        throw new Error("disk full");
      },
    };
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await expect(
        runPostRunLifecycle({
          run: runFailingAfter(EIGHT_TOOL_CALLS_IN),
          userText: "list the invoices",
          agentId: "m93-writefail",
          workspaceCwd: cwd,
          sessionStore: brokenStore,
          model: "claude-sonnet-4-5",
          hooksExecutor: new HooksExecutor(cwd),
        }),
      ).resolves.toBeUndefined();

      const emitted = stderr.mock.calls.map((c) => String(c[0])).join("");
      expect(emitted, "a swallowed write failure must still be diagnosable").toContain(
        "m93-writefail",
      );
      expect(emitted).toContain("disk full");
    } finally {
      stderr.mockRestore();
    }
  });

  it("the write has LANDED by the time the lifecycle returns — the flush is awaited", async () => {
    // `persistTurnToTranscript` is fire-and-forget by design: it chains the write and returns
    // immediately so `send()` is never blocked on disk I/O. The `await flushSessionWrites()` at the
    // end of the error path is therefore what makes the persistence observable to the caller — and
    // it is the same await that releases the per-agent send mutex. Dropping it leaves the write
    // racing the caller's next action, which on the dispose path means the process can exit first.
    //
    // The oracle is the ORDER, not the write: the store is read the instant the lifecycle resolves,
    // with nothing awaited in between.
    const store = inMemoryStore();
    const settled: string[] = [];
    const observingStore: SessionStore = {
      readRecords: store.readRecords,
      appendRecords: async (agentId, records) => {
        await store.appendRecords(agentId, records);
        settled.push("append");
      },
    };

    await runPostRunLifecycle({
      run: runFailingAfter(EIGHT_TOOL_CALLS_IN),
      userText: "list the invoices",
      agentId: "m93-flush",
      workspaceCwd: cwd,
      sessionStore: observingStore,
      model: "claude-sonnet-4-5",
      hooksExecutor: new HooksExecutor(cwd),
    });
    settled.push("lifecycle-returned");

    expect(settled, "the append must complete BEFORE the lifecycle resolves").toEqual([
      "append",
      "lifecycle-returned",
    ]);
  });

  it("COUNTERPROOF — the SUCCESS path still persists its own turn", async () => {
    // Without this, "persist on the error path" could be implemented by MOVING the success-path
    // call into the catch, which trades one silent loss for another. Both paths must persist, and
    // the success path must additionally carry the assistant's answer, which the error path by
    // definition never has.
    const store = inMemoryStore();
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    await runPostRunLifecycle({
      run: runFinishing({ id: "run-ok", status: "finished", result: "there are 3 invoices" }, [
        {
          type: "agentConversationTurn",
          turn: {
            steps: [{ type: "assistantMessage", message: { text: "there are 3 invoices" } }],
          },
        },
      ] as readonly ConversationTurn[]),
      userText: "list the invoices",
      agentId: "m93-success",
      workspaceCwd: cwd,
      sessionStore: store,
      model: "claude-sonnet-4-5",
      hooksExecutor: hooks,
    });

    const asText = JSON.stringify(store.written);
    expect(asText).toContain("list the invoices");
    expect(asText, "the success path persists the assistant answer too").toContain(
      "there are 3 invoices",
    );
  });
});
