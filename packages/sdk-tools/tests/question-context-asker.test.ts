/**
 * M76 T3.1 — the asker comes from the run's CONTEXT, not from a value pinned at construction.
 *
 * ## The design was already written down by the SDK's own authors
 *
 * The `CustomTool.handler` doc describes this use case in two sentences:
 *
 * > *"M7 — the same `ctx` also carries an optional user `context` (provided once via
 * > `SendOptions.context`), so shared config like a `projectRoot` **is read by every tool instead of
 * > baked into each factory**."*
 * >
 * > *"#119 — `ctx.threadId` is the run's session identity (…), so **a stateful tool shared across
 * > sessions can scope its state per session instead of leaking it**."*
 *
 * "baked into each factory" is literally today's `askUser`; "leaking it across sessions" is
 * literally the consumer's module singleton. The two phrases name M76's two defects.
 *
 * ## What it does NOT solve, and why that is written here
 *
 * `ContextualTool.__requiredContext` is `"Phantom — never present at runtime"`. The name suggests it
 * carries context; it carries only TYPE. Pointing at it would have produced a recommendation that
 * does not implement — the risk `/discover-edge-cases` named (EC-1) before implementation
 * began.
 *
 * ## The negative case is mandatory
 *
 * With no asker at all, the tool **must not** return a promise that never resolves: the turn would stall until the
 * 5-minute timeout. `error-handling.md` § 2 requires a typed error, and it has to be IMMEDIATE.
 */
import { describe, expect, it } from "vitest";

import { createQuestionTool } from "../src/question.js";

describe("M76 T3.1 — the asker comes from the context", () => {
  it("test_the_context_asker_beats_the_factory_one", async () => {
    let fromFactory = 0;
    let fromContext = 0;
    const t = createQuestionTool({
      askUser: async () => {
        fromFactory++;
        return "factory";
      },
    });

    const out = await t.handler(
      { question: "which?" },
      {
        context: {
          askUser: async () => {
            fromContext++;
            return "context";
          },
        },
      },
    );

    // Counting CAUSE, not inspecting text: it proves which function ran.
    expect(fromContext, "the context asker must be the one called").toBe(1);
    expect(fromFactory, "the factory one must NOT be called when one exists in the context").toBe(
      0,
    );
    expect(out).toContain("context");
  });

  it("test_without_a_context_it_uses_the_factory_one", async () => {
    // Backward compatibility: callers already building with `askUser` are unaffected.
    let fromFactory = 0;
    const t = createQuestionTool({
      askUser: async () => {
        fromFactory++;
        return "factory";
      },
    });
    const out = await t.handler({ question: "which?" });
    expect(fromFactory).toBe(1);
    expect(out).toContain("factory");
  });

  it("test_NEGATIVE_with_no_asker_an_immediate_typed_error", async () => {
    // With no asker, the old design would return a pending promise and the turn would stall 5 minutes.
    const t = createQuestionTool({});
    const start = Date.now();
    const out = (await t.handler({ question: "which?" })) as string;
    const elapsed = Date.now() - start;

    const parsed = JSON.parse(out) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error, "the error must be TYPED, not free-form prose").toBe("no_asker");
    // Immediacy is not a detail: it is the reason the consumer's `"busy"` exists.
    expect(elapsed, "must resolve immediately, not wait for the timeout").toBeLessThan(100);
  });

  it("test_a_context_without_askUser_falls_back_to_the_factory_one", async () => {
    // COUNTER-PROOF: a `context` present but without `askUser` must not be mistaken for "an asker exists".
    // Without this, an implementation checking only `ctx.context != null` would pass the tests above.
    let fromFactory = 0;
    const t = createQuestionTool({
      askUser: async () => {
        fromFactory++;
        return "factory";
      },
    });
    await t.handler({ question: "q" }, { context: { projectRoot: "/tmp" } });
    expect(fromFactory).toBe(1);
  });

  it("test_the_handler_is_reentrant_two_simultaneous_calls_do_not_contaminate_each_other", async () => {
    // M76 review (H3) — the previous NAME ("askers from distinct threadIds do not mix") claimed
    // more than this test proves. It suggested the tool ISOLATES state per session; the tool has no
    // state at all. Each `handler` captures its asker in a local `const`, so the non-mixing here is
    // **by construction**, not by isolation — and a test that cannot fail certifies nothing.
    //
    // What it legitimately protects is REENTRANCY: if someone refactored `question.ts` to
    // cache the asker in a module-level `let` (the plausible optimization), two simultaneous calls
    // would start contaminating each other and this test would fail. It is a non-regression test, and the name now says
    // that.
    //
    // The PER-SESSION isolation invariant — what actually justified killing the singleton — lives where
    // the state lives: `agents/interactive/ask-bridge.test.ts`, in the consumer. Here it would be vacuous.
    const t = createQuestionTool({});
    const calls: string[] = [];
    const asker = (tag: string) => async (): Promise<string> => {
      await new Promise((r) => setTimeout(r, 5));
      calls.push(tag);
      return tag;
    };

    const [a, b] = await Promise.all([
      t.handler({ question: "q" }, { threadId: "s1", context: { askUser: asker("s1") } }),
      t.handler({ question: "q" }, { threadId: "s2", context: { askUser: asker("s2") } }),
    ]);

    expect(calls.sort()).toEqual(["s1", "s2"]);
    expect(a).toContain("s1");
    expect(b).toContain("s2");
  });
});

/**
 * M76 review (HIGH-1 and MEDIUM-1) — the WIRING, not the capability.
 *
 * The adversarial review found the milestone's central defect: `AskBridge` supported scoping by
 * session and the handler received `ctx.threadId`, but **the value was never forwarded**. The `Map` had one
 * key forever — `let pending` under another name. The earlier tests built the bridge by hand
 * and passed `'s1'`/`'s2'`: they proved the CLASS supports it, not that the SYSTEM uses it.
 *
 * These two test the link. Without them, unhooking it again would break nothing.
 */
describe("M76 review — threadId wiring and slot release", () => {
  it("test_the_ctx_threadId_REACHES_the_asker", async () => {
    const received: (string | undefined)[] = [];
    const t = createQuestionTool({
      askUser: async (_q, threadId) => {
        received.push(threadId);
        return "ok";
      },
    });

    await t.handler({ question: "q" }, { threadId: "session-42" });

    expect(
      received[0],
      "the threadId did not reach the asker — the bridge Map would always fall into the default slot",
    ).toBe("session-42");
  });

  it("test_the_timeout_NOTIFIES_that_the_question_was_abandoned", async () => {
    // Without this notice the slot stays occupied forever: the UI keeps showing an orphaned prompt and every
    // subsequent question gets "one is already pending" — a permanent error for something nobody awaits.
    const abandoned: (string | undefined)[] = [];
    const t = createQuestionTool({
      askUser: () => new Promise<string>(() => undefined), // never resolves
      timeoutMs: 20,
      onAbandon: (threadId) => abandoned.push(threadId),
    });

    const out = (await t.handler({ question: "q" }, { threadId: "s9" })) as string;

    expect(JSON.parse(out).error).toBe("timeout");
    expect(abandoned, "the timeout must release the session slot").toEqual(["s9"]);
  });
});
