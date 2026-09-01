/**
 * M78 T1.1 — `CredentialError` joins the SDK's typed hierarchy.
 *
 * ## The causal chain this test closes
 *
 * `isTransientError` is `err instanceof TheokitAgentError && err.isRetryable === true`
 * (`src/errors.ts:443`). `CredentialError` extended a BARE `Error`
 * (`src/internal/auth/credential-store.ts:58`), so **no credential error could ever be
 * classified** — neither as transient nor as permanent. The predicate was not "forgotten" by the
 * consumer: it was useless there by construction.
 *
 * ## Why in the SDK, and not in the consumer
 *
 * agent-builder has imported `CredentialError` from the layer since M73
 * (`agents/lib/auth/credentials.ts:90`) — it does not own the class and cannot reparent it. The ROADMAP's
 * DoD frames this as consumer-side work; measurement showed it is not.
 *
 * ## What the single reference does
 *
 * Codex has ONE root enum — `CodexErr` (`protocol/src/error.rs:176`) — with `is_retryable()` as
 * method enumerating by variant. There are no parallel classes extending the language's `Error`. This is
 * our version of that.
 *
 * ## The half that matters most is preservation
 *
 * Reparenting is ADDITIVE: `CredentialError` is still a `CredentialError`, and the `instanceof` that already
 * exists in the consumer (`agents/lib/auth/login.ts:48`) stays true. A test proving only the
 * new ancestor would pass even if the class had been replaced by another.
 */
import { describe, expect, it } from "vitest";

import { AuthenticationError, isTransientError, TheokitAgentError } from "../src/errors.js";
import { CredentialError } from "../src/internal/auth/credential-store.js";

describe("M78 T1.1 — CredentialError in the typed hierarchy", () => {
  it("test_CredentialError_is_a_TheokitAgentError", () => {
    // Two levels up: CredentialError -> AuthenticationError -> TheokitAgentError.
    const err = new CredentialError("missing key");
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("test_CredentialError_remains_ITSELF", () => {
    // The preservation half. Without it, swapping the whole class for `AuthenticationError` would pass
    // the test above and break `login.ts:48` silently.
    const err = new CredentialError("missing key");
    expect(err).toBeInstanceOf(CredentialError);
    expect(err.name).toBe("CredentialError");
    expect(err.message).toBe("missing key");
  });

  it("test_COUNTERPROOF_reparenting_did_NOT_make_the_error_transient", () => {
    // Reparenting grants access to the classification; it must not TURN ON retry by accident. A revoked
    // credential retried in a loop is worse than an immediate failure — `AuthenticationError` already pins
    // `isRetryable: false` (`errors.ts:181`), and this test locks that.
    expect(isTransientError(new CredentialError("revoked"))).toBe(false);
  });

  it("test_a_generic_catch_tells_framework_from_app_with_ONE_instanceof", () => {
    // The milestone's DoD 5, proven where it originates. Before, a `catch` received a bare `Error` from the
    // store and a bare `Error` from the app, with no way to tell them apart short of comparing `name` strings.
    const fromTheFramework: unknown = new CredentialError("from the store");
    const fromTheApp: unknown = new Error("from the app");

    expect(fromTheFramework instanceof TheokitAgentError).toBe(true);
    expect(fromTheApp instanceof TheokitAgentError).toBe(false);
  });
});
