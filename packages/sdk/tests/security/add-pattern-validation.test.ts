/**
 * `Security.addPattern` rejects a non-global regex with a typed error, from the public surface.
 *
 * The validation deliberately sits in `src/security.ts` and not in the primitive it wraps.
 * `internal/security/redact.ts` has to stay BELOW `errors.ts` — the error hierarchy imports
 * `redactSecrets` for the anti-leak invariant on `providerError` — so importing `ConfigurationError`
 * there closes a cycle. Measured: `madge --circular` reported `errors.ts > internal/security/redact.ts`
 * when it was tried, and four architecture tests failed.
 *
 * So the typed error lives where a consumer meets it, and the primitive keeps a bare-Error backstop
 * for the semver-exempt `@theokit/sdk/internal/security` sub-path. That split is the finding's
 * remediation adapted to a layering rule that outranks it, rather than either one being ignored.
 */
import { describe, expect, it } from "vitest";

import { ConfigurationError, TheokitAgentError } from "../../src/errors.js";
import { Security } from "../../src/security.js";

describe("Security.addPattern", () => {
  it("rejects a non-global regex with a typed, coded error", () => {
    let thrown: unknown;
    try {
      Security.addPattern(/sk-[a-z0-9]+/);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect(thrown).toBeInstanceOf(TheokitAgentError);
    expect((thrown as ConfigurationError).code).toBe("invalid_redaction_pattern");
  });

  it("accepts a global regex", () => {
    // Registering does not enable redaction, and this pattern matches nothing real — the assertion
    // is only that the guard lets a correctly-flagged pattern through.
    expect(() => Security.addPattern(/theokit-test-sentinel-[a-z]+/g)).not.toThrow();
  });
});
