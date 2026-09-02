import { describe, expect, it } from "vitest";
import {
  HANDSHAKE_FLOOR_MS,
  handshakeAwareTimeout,
} from "../../../src/internal/mcp/handshake-timeout.js";

/**
 * The rule `tests/mcp/handshake-has-its-own-budget.test.ts` exists to prove, tested where it is a
 * DECISION rather than a duration.
 *
 * That file spends ~400ms of sleep, spawns four child processes, and races a hand-picked 120ms
 * against the cost of starting Node — measured 2026-09-02 at 16-26ms idle and 39-60ms with every
 * core saturated, so its margin is 2.5x on a loaded host and unknown on a slower CI runner. None of
 * that is the claim. The claim is which deadline applies to which call, and that is a pure function
 * of three values.
 *
 * WHAT THIS COVERS THAT NOTHING DID. `timeoutFor` was private and the string `HANDSHAKE_FLOOR` did
 * not appear anywhere under tests/. The docblock promises "A FLOOR, not a replacement: a caller who
 * deliberately sets a LARGER request timeout keeps it" — and replacing `Math.max(timeout, FLOOR)`
 * with a bare `FLOOR` left all three integration tests green. That case is the fourth one below.
 *
 * WHAT THIS DOES NOT COVER, which is why the integration file stays: that the reconnect loop
 * actually reaches the handshake with `reconnecting === true`. A correct rule wired to nothing is
 * the exact defect that file was written for.
 */
describe("handshakeAwareTimeout — which budget applies to which call", () => {
  it("gives the reconnect handshake the floor, not the caller's request budget", () => {
    expect(
      handshakeAwareTimeout({ method: "initialize", reconnecting: true, requestTimeoutMs: 120 }),
    ).toBe(HANDSHAKE_FLOOR_MS);
  });

  it("keeps a LARGER caller budget — the floor raises, it never lowers", () => {
    // The clause the docblock states and nothing verified. With `Math.max` replaced by a bare
    // `HANDSHAKE_FLOOR_MS`, every integration test still passes and this one fails.
    const generous = HANDSHAKE_FLOOR_MS + 5_000;
    expect(
      handshakeAwareTimeout({
        method: "initialize",
        reconnecting: true,
        requestTimeoutMs: generous,
      }),
    ).toBe(generous);
  });

  it("leaves the FIRST connect on the caller's budget", () => {
    // Deliberate, and the reason is which failure is visible: a `requestTimeoutMs` too small to
    // connect at all fails at the call the caller made, immediately, and is theirs to correct.
    // `client-timeout.test.ts` pins the consequence — a silent server rejects within 2s at 150ms.
    expect(
      handshakeAwareTimeout({ method: "initialize", reconnecting: false, requestTimeoutMs: 120 }),
    ).toBe(120);
  });

  it("leaves an ordinary method on the caller's budget, even mid-reconnect", () => {
    // A floor on every method would turn `requestTimeoutMs` into a suggestion — a worse defect than
    // the one it fixes. `reconnecting` is true here to pin that the METHOD is half the condition,
    // not just the flag.
    expect(
      handshakeAwareTimeout({ method: "tools/list", reconnecting: true, requestTimeoutMs: 2_000 }),
    ).toBe(2_000);
    expect(
      handshakeAwareTimeout({ method: "tools/call", reconnecting: false, requestTimeoutMs: 2_000 }),
    ).toBe(2_000);
  });

  it("is a pure function of its input — no clock, no ambient state", () => {
    // Called twice with the same input across a real time gap, in case someone reaches for
    // `Date.now()` inside it later. A rule that drifts with the clock is not a rule.
    const input = { method: "initialize", reconnecting: true, requestTimeoutMs: 120 } as const;
    const first = handshakeAwareTimeout(input);
    const busy = Date.now() + 5;
    while (Date.now() < busy) {
      /* burn a few ms of real time */
    }
    expect(handshakeAwareTimeout(input)).toBe(first);
  });
});
