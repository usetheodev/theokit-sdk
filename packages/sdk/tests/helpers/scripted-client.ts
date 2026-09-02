/**
 * An `LlmClient` that answers a fixed script of rounds, and says how many it was asked for.
 *
 * A test about MULTI-ROUND behaviour has to keep state across `stream()` calls, and every such test
 * in this directory did it the same way: a `let round = 0` in the test body, `round += 1` at the top
 * of the generator, and an `if (round === 1) … else …` ladder. That is ~30 lines of scaffolding per
 * test, in front of the ~20 lines of assertion that are the point — `thinking-round-scoping.test.ts`
 * ran to 95 lines for one behaviour because of it.
 *
 * `roundsAsked()` is part of the contract rather than an afterthought: a scripted stub that runs out
 * of script returns its last round forever, so a test that asserts on round 2 must be able to prove
 * round 2 was reached. Without that check a loop that stopped after one round passes every
 * assertion about "the second turn" by never producing one.
 *
 * @see makeTextLlm in ./llm-stubs.ts — the single-round case, which needs none of this.
 */
import type { LlmClient, LlmEvent, LlmFinish } from "../../src/internal/llm/types.js";

export interface ScriptedRound {
  /** Streamed before the round finishes. Omitted when the round yields nothing. */
  readonly events?: ReadonlyArray<LlmEvent>;
  readonly finish: LlmFinish;
}

export interface ScriptedClient {
  readonly client: LlmClient;
  /** How many rounds the loop actually asked for. Assert on it before trusting a per-round claim. */
  roundsAsked(): number;
}

export function scriptedClient(rounds: ReadonlyArray<ScriptedRound>): ScriptedClient {
  if (rounds.length === 0) throw new Error("scriptedClient needs at least one round");
  let asked = 0;
  return {
    roundsAsked: () => asked,
    client: {
      name: "stub",
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        asked += 1;
        // Past the end of the script the last round repeats, so an over-running loop shows up as a
        // `roundsAsked()` mismatch rather than as a crash somewhere unrelated.
        const round = rounds[Math.min(asked, rounds.length) - 1] as ScriptedRound;
        for (const event of round.events ?? []) yield event;
        return round.finish;
      },
    },
  };
}
