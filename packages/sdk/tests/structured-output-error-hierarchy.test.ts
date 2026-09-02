/**
 * `generateObject` and `streamObject` report the same failure contract, from one class, under two
 * names that stay distinct.
 *
 * The contract was written twice with byte-identical user-facing strings, so improving one improved
 * half the product. It now lives in `internal/structured-output-helpers.ts`, and both public classes
 * are thin subclasses of it.
 *
 * Two things had to stay true through that change, and neither is obvious, so both are asserted:
 *
 * 1. The two names remain DIFFERENT types. Collapsing them into aliases of one class — one of the
 *    options on the table — would make `streamObjectError instanceof GenerateObjectError` true. The
 *    duplication worth removing was the contract, not the identity.
 * 2. Both are now `TheokitAgentError`s. They were not, so a consumer following the documented
 *    `catch (e) { if (e instanceof TheokitAgentError) }` missed both entirely.
 */
import { describe, expect, it } from "vitest";

import { TheokitAgentError } from "../src/errors.js";
import { GenerateObjectError } from "../src/generate-object.js";
import { StreamObjectError } from "../src/stream-object.js";

describe("structured-output error hierarchy", () => {
  it("both classes are catchable as TheokitAgentError", () => {
    for (const err of [
      new GenerateObjectError("no_tool_call", "x"),
      new StreamObjectError("parse_failed", "y"),
    ]) {
      expect(err).toBeInstanceOf(TheokitAgentError);
      expect(err).toBeInstanceOf(Error);
      expect(
        err.isRetryable,
        "the caller's own maxRetries is already spent when either is thrown",
      ).toBe(false);
    }
  });

  it("keeps the two public names distinct", () => {
    const generate = new GenerateObjectError("no_tool_call", "x");
    const stream = new StreamObjectError("no_tool_call", "x");
    expect(generate).not.toBeInstanceOf(StreamObjectError);
    expect(stream).not.toBeInstanceOf(GenerateObjectError);
    expect(generate.name).toBe("GenerateObjectError");
    expect(stream.name).toBe("StreamObjectError");
  });

  it("carries the code and the cause it was given", () => {
    const cause = new Error("underlying");
    const err = new GenerateObjectError("parse_failed", "boom", cause);
    expect(err.code).toBe("parse_failed");
    expect(err.cause).toBe(cause);
    expect(err.message).toBe("boom");
  });
});
