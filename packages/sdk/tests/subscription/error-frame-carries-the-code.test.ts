import { describe, expect, it } from "vitest";
import { errorFrame } from "../../src/subscription/internal/subscription-runtime.js";
import { SubscriptionError, SubscriptionInputError } from "../../src/subscription/types.js";

/**
 * `WireFrame.error.code` was declared in the wire format and written by nobody. All three producers
 * sent `{ message }`, and the WS client turned every inbound error into one `ws_server_error` — so a
 * subsystem that defines coded errors deliberately (`subscription_input_invalid`,
 * `subscription_disconnected`) collapsed all of them at the wire, and the real reason survived only
 * as interpolated English inside a message a caller would have had to parse.
 *
 * A declared-and-never-written field stays that way when nothing asserts it. This asserts it.
 */
describe("the error frame carries the cause's code", () => {
  it("propagates the code of a typed subscription error", () => {
    const frame = errorFrame(
      // The class sets its own code; the test does not get to choose it, which is what makes this a
      // check on propagation rather than on an argument the test passed in.
      new SubscriptionInputError("bad input", { issues: [] }),
    );

    expect(frame.type).toBe("error");
    expect(frame.error?.message).toBe("bad input");
    expect(
      frame.error?.code,
      "the code is the whole point — a caller branches on this, not on the sentence",
    ).toBe("subscription_input_invalid");
  });

  it("omits the field rather than inventing one when the cause carries no code", () => {
    const frame = errorFrame(new SubscriptionError("no code here"));

    expect(frame.error?.message).toBe("no code here");
    expect(
      "code" in (frame.error ?? {}),
      "an absent code must stay absent so the client's own fallback applies",
    ).toBe(false);
  });

  it("handles a non-Error cause without losing the message", () => {
    expect(errorFrame("plain string").error).toEqual({ message: "plain string" });
  });
});
