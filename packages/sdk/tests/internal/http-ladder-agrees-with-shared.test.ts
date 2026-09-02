/**
 * `mapHttpStatusToError` and `httpStatusToErrorCode` must not drift apart again.
 *
 * `internal/http.ts` is the fifth site that reads an HTTP status and decides what the
 * caller catches. The other four — the provider mappers — were unified onto one
 * definition; this one was NOT, and deliberately so: it maps a status straight to an
 * error CLASS rather than to a code, and its 4xx arm is a catch-all where the shared
 * ladder answers only for 400. Those are different contracts, not drift. Forcing them
 * together would silently turn a 404 from the Theokit API into an `UnknownAgentError`
 * where callers have been catching `ConfigurationError`.
 *
 * What IS drift, and what already happened, is the two disagreeing about a status they
 * both have an opinion on. 408 fell through this file's generic 4xx arm and came back
 * `ConfigurationError` — non-retryable — while every provider mapper called it a
 * retryable timeout. Nothing threw; callers simply refused to retry a request that
 * would have succeeded.
 *
 * So this file pins the OVERLAP and names the exception. A status added to the shared
 * ladder that this file answers differently now fails here rather than in production.
 */
import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  type TheokitAgentError,
} from "../../src/errors.js";
import {
  type HttpStatusErrorCode,
  httpStatusToErrorCode,
} from "../../src/internal/error-mappers/shared.js";
import { mapHttpStatusToError } from "../../src/internal/http.js";

/**
 * The class each shared-ladder code must produce when this file is the one deciding.
 * `unknown` is absent on purpose — it is exactly where the two contracts legitimately
 * differ, and it is asserted separately below.
 */
const CLASS_FOR_CODE: Partial<
  Record<HttpStatusErrorCode, new (...args: never[]) => TheokitAgentError>
> = {
  auth_failed: AuthenticationError,
  rate_limit: RateLimitError,
  timeout: NetworkError,
  invalid_request: ConfigurationError,
  server_error: NetworkError,
};

/** Statuses where BOTH ladders have an opinion. */
const OVERLAP = [400, 401, 403, 408, 429, 500, 503] as const;

describe("the generic HTTP ladder agrees with the shared provider ladder", () => {
  it.each(OVERLAP)("HTTP %i produces the class the shared code implies", (status) => {
    const code = httpStatusToErrorCode(status);
    const expected = CLASS_FOR_CODE[code];
    expect(expected, `no class pinned for shared code "${code}"`).toBeDefined();

    const err = mapHttpStatusToError(status, {});
    expect(
      err,
      `HTTP ${status}: the shared ladder says "${code}" but internal/http.ts disagreed. ` +
        "That is the 408 defect repeating under a different number.",
    ).toBeInstanceOf(expected as new (...args: never[]) => TheokitAgentError);
  });

  it("408 is retryable on both sides — the divergence that motivated this file", () => {
    expect(httpStatusToErrorCode(408)).toBe("timeout");
    const err = mapHttpStatusToError(408, {});
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.isRetryable).toBe(true);
  });

  it("the 4xx catch-all is a DIFFERENT contract, not drift", () => {
    // The shared ladder has no opinion on 404 and answers `unknown`; this file treats
    // any unclassified 4xx as a caller error. Both are defensible and they are pinned
    // here so the difference stays a decision instead of becoming an accident.
    expect(httpStatusToErrorCode(404)).toBe("unknown");
    expect(mapHttpStatusToError(404, {})).toBeInstanceOf(ConfigurationError);
  });
});
