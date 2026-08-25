/**
 * usetheokit/theokit-sdk#383 — the agent loop puts a session-scoped `promptCacheKey` on every
 * request it makes.
 *
 * The provider reuses a cached prompt prefix only across requests carrying the SAME key, so the
 * field is worth nothing unless it is stable across the rounds of a turn and across the turns of a
 * session — and is a correctness hazard if it leaks between unrelated sessions. Asserting only that
 * the field is present would pass for a `Math.random()` minted per round, which is exactly the
 * failure mode that caches nothing. So every assertion here compares keys taken from two different
 * requests.
 *
 * The stub records what the loop asked for rather than what any transport serialised: the loop is
 * where the session identity is available, and it is the only place that can get this wrong for
 * every provider at once.
 */

import { describe, expect, it } from "vitest";

import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/loop-types.js";
import { derivePromptCacheKey } from "../../../src/internal/llm/prompt-cache-key.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
} from "../../../src/internal/llm/types.js";
import { HooksExecutor } from "../../../src/internal/runtime/hooks/hooks-executor.js";

/**
 * A stub whose round 1 calls a tool it knows nothing about and round 2 answers with text — two
 * rounds inside ONE turn, which is the interval the issue measured. Every request's cache key is
 * recorded in call order.
 */
function twoRoundRecordingClient(seen: Array<string | undefined>): LlmClient {
  let round = 0;
  return {
    name: "stub",
    async *stream(request: LlmRequest): AsyncGenerator<LlmEvent, LlmFinish, void> {
      seen.push(request.promptCacheKey);
      round += 1;
      if (round === 1) {
        return {
          stopReason: "tool_use",
          text: "",
          toolCalls: [{ type: "tool_use", id: "call_1", name: "no_such_tool", input: {} }],
        };
      }
      yield { type: "text_delta", text: "done" };
      return { stopReason: "end_turn", text: "done", toolCalls: [] };
    },
  };
}

/**
 * Runs are what a session is made of, so `runId` is unique per call here as it is in production.
 * Without that, a key derived from the run id would pass the cross-turn test by accident and the
 * suite would not distinguish session scope from run scope at all.
 */
let runCounter = 0;

function makeInputs(agentId: string, llm: LlmClient): AgentLoopInputs {
  runCounter += 1;
  return {
    agentId,
    runId: `run-${String(runCounter)}`,
    userMessage: "hi",
    model: { id: "stub-model" },
    llm,
    mcp: new Map(),
    hooks: new HooksExecutor(process.cwd()),
    shellCwd: process.cwd(),
    shellSandbox: false,
  };
}

describe("usetheokit/theokit-sdk#383 — prompt cache key is session-scoped", () => {
  it("test_both_rounds_of_one_turn_carry_the_same_key", async () => {
    const seen: Array<string | undefined> = [];

    await runAgentLoop(makeInputs("agent-one-turn", twoRoundRecordingClient(seen)));

    expect(seen.length, `expected two rounds, saw ${seen.length}`).toBe(2);
    expect(seen[0], "round 1 sent no cache key at all").toBeDefined();
    expect(
      seen[1],
      `round 2 sent ${String(seen[1])} where round 1 sent ${String(seen[0])} — a key that changes ` +
        "per round tells the provider to cache and then never lets it hit",
    ).toBe(seen[0]);
  });

  it("test_a_second_turn_of_the_same_session_carries_the_same_key", async () => {
    const first: Array<string | undefined> = [];
    const second: Array<string | undefined> = [];

    await runAgentLoop(makeInputs("agent-same-session", twoRoundRecordingClient(first)));
    await runAgentLoop(makeInputs("agent-same-session", twoRoundRecordingClient(second)));

    expect(
      second[0],
      `turn 2 sent ${String(second[0])} where turn 1 sent ${String(first[0])} — the cached prefix ` +
        "of a session must survive the turn boundary",
    ).toBe(first[0]);
  });

  it("test_two_sessions_carry_different_keys", async () => {
    const first: Array<string | undefined> = [];
    const second: Array<string | undefined> = [];

    await runAgentLoop(makeInputs("agent-session-a", twoRoundRecordingClient(first)));
    await runAgentLoop(makeInputs("agent-session-b", twoRoundRecordingClient(second)));

    expect(
      second[0],
      "two unrelated sessions sharing a key ask the provider to match one conversation's prefix " +
        "against another's — worse than sending no key",
    ).not.toBe(first[0]);
  });

  it("test_the_key_is_derived_from_the_session_id_and_not_a_second_identity", async () => {
    const seen: Array<string | undefined> = [];

    await runAgentLoop(makeInputs("agent-derivation", twoRoundRecordingClient(seen)));

    // Pins WHICH identity the key comes from. A key minted per run (`runId`) or per process would
    // satisfy every same-turn assertion above and still be cold on the next turn.
    expect(seen[0], "the key must be the derivation of the session id, nothing else").toBe(
      derivePromptCacheKey("agent-derivation"),
    );
  });
});
