/**
 * Two different public classes must not answer to the same name.
 *
 * `@theokit/sdk` and `@theokit/sdk/persistence` are both declared subpaths, so one consumer can hold
 * both. Each exported a class called `LiveSessionError`, both extending `TheokitAgentError`, both
 * setting `name = "LiveSessionError"`, with incompatible shapes:
 *
 *   root       — `new LiveSessionError(sessionId, reason)`, fields `sessionId` + `reason`, no `code`
 *   persistence — `new LiveSessionError(path)`, field `path`, `code: "live_session_protected"`
 *
 * The failure is quiet in the way that costs most. `instanceof` is class identity, so a `catch` that
 * checks the one imported from the root silently does not match the one thrown from persistence —
 * and the fallback path runs for a condition the code believed it had handled. Meanwhile
 * `err.name === "LiveSessionError"` matches BOTH, so a name check appears to work and then reads
 * `err.reason`, which exists on only one of them.
 *
 * They are about different things: refusing to DESTROY a session, and refusing to OVERWRITE a
 * transcript file. The names now say so.
 */
import { describe, expect, it } from "vitest";

import { LiveSessionError } from "../src/index.js";
import { LiveTranscriptError } from "../src/persistence.js";

describe("the two live-session refusals are distinguishable", () => {
  it("they are different classes with different names", () => {
    const destroy = new LiveSessionError("s1", "session-is-live");
    const overwrite = new LiveTranscriptError("/tmp/t.jsonl");

    expect(destroy.name).toBe("LiveSessionError");
    expect(overwrite.name).toBe("LiveTranscriptError");
    // Compared as plain strings on purpose. Typed directly, `tsc` rejects the comparison with
    // "these literal types have no overlap" — which is the fix working, and is not something a
    // runtime assertion can express. The string form keeps the runtime guarantee compiling.
    expect(
      (destroy.name as string) === (overwrite.name as string),
      "two public classes sharing a name make `err.name` useless as a discriminator",
    ).toBe(false);
  });

  it("instanceof does not cross the pair, which is why the names had to differ", () => {
    const overwrite = new LiveTranscriptError("/tmp/t.jsonl");
    expect(
      overwrite instanceof LiveSessionError,
      "class identity never crossed the pair — the shared NAME was the only thing suggesting it did",
    ).toBe(false);
  });

  it("each carries the field its own situation is about", () => {
    expect(new LiveSessionError("s1", "liveness-undetermined").reason).toBe(
      "liveness-undetermined",
    );
    expect(new LiveTranscriptError("/tmp/t.jsonl").path).toBe("/tmp/t.jsonl");
    expect(new LiveTranscriptError("/tmp/t.jsonl").code).toBe("live_session_protected");
  });
});
