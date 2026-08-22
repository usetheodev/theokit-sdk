import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../../../src/errors.js";
import { sanitizeIdentifier } from "../../../src/internal/security/index.js";

/*
 * #368 — `sanitizeIdentifier` threw TWO error classes, and the attacker's bytes chose which.
 *
 * A NUL / C0 control char / DEL yielded `PathTraversalError` (code `path_traversal`); every other
 * rejection yielded `ConfigurationError` (code `invalid_identifier`). A caller branching on the
 * documented code — the shape an HTTP handler uses to answer 400 — rethrew for exactly the input
 * class an attacker controls, turning a rejection into a 500 and handing a probe a 400/500 oracle
 * for which branch it reached.
 *
 * The input was rejected either way, so this was never a traversal bypass. What was wrong is the
 * unannounced error-class split across a published API. The precise diagnostic that motivated the
 * split ("nul-byte", "control-char-0x..") is worth keeping and does not require a second class.
 */

describe("sanitizeIdentifier rejects with one code", () => {
  const rejected: ReadonlyArray<readonly [string, string]> = [
    ["a NUL byte", "abc\x00def"],
    ["a C0 control char", "abc\x1fdef"],
    ["DEL", "abc\x7fdef"],
    ["a path separator", "a/b"],
    ["a parent-directory hop", ".."],
    ["an embedded space", "agent /etc/passwd"],
    ["a leading dash", "-agent"],
    ["the empty string", ""],
  ];

  for (const [label, input] of rejected) {
    it(`reports ${label} as invalid_identifier`, () => {
      let thrown: unknown;
      try {
        sanitizeIdentifier(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `"${input}" must be rejected`).toBeInstanceOf(ConfigurationError);
      expect((thrown as ConfigurationError).code).toBe("invalid_identifier");
    });
  }

  it("keeps the precise diagnostic that the control-char branch exists for", () => {
    // Collapsing the code must not collapse the message: an operator reading a prompt-injection
    // trace needs to see WHICH byte was refused, not just "invalid characters".
    expect(() => sanitizeIdentifier("abc\x00def")).toThrow(/nul-byte/i);
    expect(() => sanitizeIdentifier("abc\x1fdef")).toThrow(/control-char-0x1f/i);
  });

  it("still accepts a valid identifier", () => {
    // The accepted case (`testing.md` § 4.2). A validator that refused everything would satisfy
    // every assertion above.
    expect(sanitizeIdentifier("valid-id_123")).toBe("valid-id_123");
    expect(sanitizeIdentifier("Agent1")).toBe("agent1");
  });
});
