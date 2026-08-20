import { describe, expect, expectTypeOf, it } from "vitest";

import { streamToCompletionImpl } from "../src/internal/runtime/lifecycle/stream-to-completion.js";
import type { SDKMessage } from "../src/types/messages.js";
import type {
  RunOperation,
  RunResult,
  RunToCompletionResult,
  StreamToCompletionResult,
} from "../src/types/run.js";

/**
 * V3-4 (plan v34-stream-to-completion) — the STREAMING continuation driver.
 *
 * The streaming twin of `runToCompletion`: it yields each round's SDKMessages
 * LIVE (the V3-4 (a) gap) while reusing the same `classifyRound` terminal policy
 * (done / step_limit / no_progress + bounded re-prompt). Tested via an injected
 * fake `send` returning a scripted (events, result) per round — deterministic,
 * no LLM. The driver's RETURN value (StreamToCompletionResult) is the generator
 * return, NOT a yielded value (EC-1).
 */
function rr(over: Partial<RunResult> = {}): RunResult {
  return { id: "r", status: "finished", result: "ok", ...over };
}
const msg = (id: string): SDKMessage =>
  ({ type: "assistant", content: id }) as unknown as SDKMessage;

/** Fake agent: each round yields `events` then resolves `result`. */
function fakeAgent(rounds: Array<{ events: SDKMessage[]; result: RunResult }>) {
  const sends: string[] = [];
  let i = 0;
  return {
    sends,
    send: (m: string) => {
      sends.push(m);
      const round = rounds[Math.min(i, rounds.length - 1)] as {
        events: SDKMessage[];
        result: RunResult;
      };
      i += 1;
      return Promise.resolve({
        stream: async function* () {
          for (const e of round.events) yield e;
        },
        wait: () => Promise.resolve(round.result),
      });
    },
  };
}

/** Drive the generator to completion, collecting yielded msgs + the return value (EC-1 idiom). */
async function drive(gen: AsyncGenerator<SDKMessage, unknown>) {
  const yielded: SDKMessage[] = [];
  let res = await gen.next();
  while (!res.done) {
    yielded.push(res.value);
    res = await gen.next();
  }
  return { yielded, result: res.value };
}

const truncated = (over: Partial<RunResult> = {}) => rr({ stoppedAtIterationLimit: true, ...over });

describe("streamToCompletionImpl (V3-4)", () => {
  it("test_stream_to_completion_types — StreamToCompletionResult shape + RunOperation member", () => {
    // The plan's T1.1 type contract (expectTypeOf, not a runtime cast).
    // StreamToCompletionResult is the same shape + terminal semantics as the M1 result.
    expectTypeOf<StreamToCompletionResult>().toEqualTypeOf<RunToCompletionResult>();
    expectTypeOf<StreamToCompletionResult["terminal"]>().toEqualTypeOf<
      "done" | "step_limit" | "no_progress"
    >();
    expectTypeOf<StreamToCompletionResult["lastResult"]>().toEqualTypeOf<RunResult>();
    // RunOperation must accept the new operation (cloud-throw + supports() key).
    expectTypeOf<"streamToCompletion">().toMatchTypeOf<RunOperation>();
    // The impl returns an AsyncGenerator yielding SDKMessage, returning the result.
    expectTypeOf(streamToCompletionImpl).returns.toEqualTypeOf<
      AsyncGenerator<SDKMessage, StreamToCompletionResult>
    >();
  });

  it("test_stream_to_completion_yields_each_round_events_in_order", async () => {
    const agent = fakeAgent([
      { events: [msg("m0a"), msg("m0b")], result: truncated() },
      { events: [msg("m1a")], result: rr() }, // done
    ]);
    const { yielded, result } = await drive(streamToCompletionImpl(agent, "task"));
    expect(yielded).toEqual([msg("m0a"), msg("m0b"), msg("m1a")]);
    expect(result).toMatchObject({ terminal: "done", rounds: 1 });
  });

  it("test_stream_to_completion_done_first_round", async () => {
    const agent = fakeAgent([{ events: [msg("a")], result: rr() }]);
    const { yielded, result } = await drive(streamToCompletionImpl(agent, "task"));
    expect(yielded).toEqual([msg("a")]);
    expect(result).toMatchObject({ terminal: "done", rounds: 0 });
  });

  it("test_stream_to_completion_step_limit", async () => {
    const agent = fakeAgent([{ events: [msg("x")], result: truncated() }]); // every round truncates
    const { result } = await drive(streamToCompletionImpl(agent, "task", { maxRounds: 2 }));
    expect(result).toMatchObject({ terminal: "step_limit", rounds: 2 });
  });

  it("test_stream_to_completion_no_progress", async () => {
    const agent = fakeAgent([{ events: [], result: truncated({ result: "" }) }]); // empty + truncated
    const { result } = await drive(streamToCompletionImpl(agent, "task", { maxRounds: 8 }));
    expect(result).toMatchObject({ terminal: "no_progress" });
  });

  it("test_stream_to_completion_aborts_between_rounds", async () => {
    const ctrl = new AbortController();
    const agent = fakeAgent([{ events: [msg("x")], result: truncated() }]);
    // abort after the first round's stream is consumed
    const gen = streamToCompletionImpl(agent, "task", { maxRounds: 8, signal: ctrl.signal });
    const yielded: SDKMessage[] = [];
    let res = await gen.next();
    while (!res.done) {
      yielded.push(res.value);
      ctrl.abort();
      res = await gen.next();
    }
    expect(res.value).toMatchObject({ terminal: "step_limit" });
    expect(agent.sends).toHaveLength(1); // round 1 never sent
  });

  it("test_stream_to_completion_return_value_via_manual_next — EC-1", async () => {
    // The StreamToCompletionResult is the generator RETURN value, invisible to for-await.
    const agent = fakeAgent([
      {
        events: [msg("a")],
        result: rr({ usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 } }),
      },
    ]);
    const gen = streamToCompletionImpl(agent, "task");
    let res = await gen.next();
    while (!res.done) res = await gen.next();
    expect(res.value).toMatchObject({ terminal: "done", rounds: 0, usage: { totalTokens: 8 } });
  });

  it("test_stream_to_completion_early_break_cleanup — EC-2", async () => {
    const agent = fakeAgent([
      { events: [msg("m0a"), msg("m0b")], result: truncated() },
      { events: [msg("m1a")], result: rr() },
    ]);
    const gen = streamToCompletionImpl(agent, "task");
    const first = await gen.next(); // pull one msg
    expect(first.value).toEqual(msg("m0a"));
    await gen.return(undefined as never); // caller abandons (for-await break)
    expect(agent.sends).toHaveLength(1); // the next round was never sent
  });
});
