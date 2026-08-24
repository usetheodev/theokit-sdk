/**
 * B-003 — `mapHttpStatusToError` decides WHICH error class the caller catches, and had no test.
 *
 * The item reads "HTTP status-to-typed-error mapping is untested (internal/http.ts, 172 LOC)". Both
 * halves needed measuring, and they disagree:
 *
 *   command grep -rl "internal/http"        tests/  ->  114 files
 *   command grep -rn "mapHttpStatusToError" tests/  ->  no matches
 *
 * The MODULE is referenced by 114 test files; the FUNCTION the sentence is about has none. And
 * "172 LOC" sizes the file, not the work — the work is six branches of one pure function.
 *
 * Why an untested branch here is worse than a crash: this function throws nothing. A wrong branch
 * hands the caller a `ConfigurationError` where an `AuthenticationError` belonged, and the caller's
 * `catch` then behaves correctly for the wrong situation — retrying a permission failure, or
 * refusing to retry a transient one. The damage surfaces far from here.
 *
 * So the mutant that matters is a SUBSTITUTION, not a deletion: deleting a branch falls through to
 * the next one and still produces an error, which is the defect rather than its absence.
 */

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
} from "../../src/errors.js";
import { mapHttpStatusToError, readErrorResponseBody } from "../../src/internal/http.js";

describe("mapHttpStatusToError", () => {
  it("test_401_and_403_are_authentication_failures", () => {
    for (const status of [401, 403]) {
      // ADR D1 asked for class AND code, and the first version of this file asserted class only —
      // which review broke with a drop-in subclass: `CredentialError extends AuthenticationError`
      // (credential-store.ts:76) satisfies `toBeInstanceOf` and survives all eight mutants. The
      // class says "authentication-shaped"; the code says WHICH guard produced it.
      const err = mapHttpStatusToError(status, { error: { code: "auth_required" } });
      expect(err, `HTTP ${status} must be an authentication failure`).toBeInstanceOf(
        AuthenticationError,
      );
      expect(err.constructor.name, "and not a subclass standing in for it").toBe(
        "AuthenticationError",
      );
      expect((err as AuthenticationError & { code?: string }).code).toBe("auth_required");
    }
  });

  it("test_429_is_a_rate_limit_not_a_generic_client_error", () => {
    // 429 sits inside the 4xx range, so it reaches this branch only because the check precedes the
    // generic one. Swap the order and it silently becomes a ConfigurationError — which a caller
    // would not retry, turning a transient throttle into a permanent failure.
    const err = mapHttpStatusToError(429, {});
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.constructor.name, "exactly RateLimitError, not a subclass").toBe("RateLimitError");
  });

  it("test_other_4xx_are_configuration_errors", () => {
    const err = mapHttpStatusToError(400, {});

    expect(err).toBeInstanceOf(ConfigurationError);
    // `IntegrationNotConnectedError extends ConfigurationError`, so `instanceof` alone cannot tell
    // this branch from the envelope branch below. The absence of the subclass is the real claim.
    expect(err, "a plain 4xx must NOT be the integration-specific subclass").not.toBeInstanceOf(
      IntegrationNotConnectedError,
    );
    // `ConfigurationError` has three subclasses in src/, not one — naming the exact constructor is
    // what excludes all of them rather than the one I happened to think of.
    expect(err.constructor.name).toBe("ConfigurationError");
  });

  it("test_5xx_are_network_errors_so_the_caller_may_retry", () => {
    for (const status of [500, 503]) {
      const err = mapHttpStatusToError(status, {});
      expect(err).toBeInstanceOf(NetworkError);
      expect(err.constructor.name, `HTTP ${status} exactly NetworkError`).toBe("NetworkError");
    }
  });

  it("test_a_status_below_400_falls_back_rather_than_guessing", () => {
    // Reaching here means the caller treated a non-error status as an error. The fallback exists so
    // that is visible as "unknown" instead of being classified as something specific.
    const err = mapHttpStatusToError(200, {});
    expect(err).toBeInstanceOf(UnknownAgentError);
    expect(err.constructor.name).toBe("UnknownAgentError");
  });

  it("test_the_envelope_code_wins_over_the_status", () => {
    // The branch I had missed when counting: this one decides on the response BODY, not the status.
    // A 400 carrying `integration_not_connected` is NOT a generic configuration error, and a test
    // that only varied the status would never reach it.
    const err = mapHttpStatusToError(400, {
      error: { code: "integration_not_connected", provider: "github", helpUrl: "https://x.test" },
    });

    expect(err).toBeInstanceOf(IntegrationNotConnectedError);
    expect((err as IntegrationNotConnectedError & { code?: string }).code).toBe(
      "integration_not_connected",
    );
  });

  it("test_the_envelope_message_is_carried_and_the_body_is_the_cause", () => {
    // Without the message the caller sees `HTTP 400` and loses what the server said; without the
    // cause the body is gone and the failure cannot be diagnosed from the log alone.
    const body = { error: { message: "quota exhausted for project x" } };

    const err = mapHttpStatusToError(400, body);

    expect(err.message).toBe("quota exhausted for project x");
    expect((err as ConfigurationError).cause).toBe(body);
  });

  it("test_a_missing_message_degrades_to_the_status_rather_than_to_empty", () => {
    expect(mapHttpStatusToError(418, {}).message).toBe("HTTP 418");
  });
});

describe("readErrorResponseBody", () => {
  // B-003's dod names this function and a non-JSON body; the first version of this batch left it
  // untested and the commit title still claimed the item. Zero test references suite-wide before
  // this block.
  //
  // It feeds `mapHttpStatusToError`: whatever it returns becomes the envelope the mapper reads and
  // the `cause` the caller receives. A wrong return here does not throw either — it makes the mapper
  // classify against the wrong shape.

  it("test_a_json_body_is_parsed_so_the_envelope_is_readable", async () => {
    const body = await readErrorResponseBody(
      new Response('{"error":{"code":"rate_limited"}}', { status: 429 }),
    );

    expect(body, "the mapper reads `.error.code` off this — a string would defeat it").toEqual({
      error: { code: "rate_limited" },
    });
  });

  it("test_a_non_json_body_is_kept_as_text_rather_than_thrown_away", async () => {
    // The dod's case. An HTML error page or a proxy's plain-text message is exactly when the
    // operator most needs the body — and JSON.parse throwing here would lose it.
    const body = await readErrorResponseBody(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );

    expect(body).toBe("<html>502 Bad Gateway</html>");
  });

  it("test_an_empty_body_degrades_to_an_empty_string_not_to_a_throw", async () => {
    expect(await readErrorResponseBody(new Response("", { status: 500 }))).toBe("");
  });

  it("test_a_body_that_cannot_be_read_is_absorbed", async () => {
    // `.text()` rejecting (a socket dying mid-read) must not turn an HTTP error into an unrelated
    // exception — the caller would lose the status entirely.
    const broken = {
      text: () => Promise.reject(new Error("socket closed")),
    } as unknown as Response;

    await expect(readErrorResponseBody(broken)).resolves.toBe("");
  });
});
