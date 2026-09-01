/**
 * The HTTP status ladder must mean the same thing in every provider mapper.
 *
 * The ladder is RFC 9110 semantics — a 429 is a 429 whether Anthropic, OpenAI,
 * Bedrock or Vertex sent it — but it was written out four times, and by the time
 * this test was added the copies had drifted twice:
 *
 *   1. HTTP 402 -> `quota_exceeded` reached `openai-compatible` only. The other
 *      three answered `unknown`: the canonical bucket existed and three of four
 *      mappers could not reach it.
 *   2. `anthropic` and `openai-compatible` bounded the server arm at
 *      `>= 500 && < 600`; `bedrock` and `vertex` left it open, so a malformed
 *      6xx was `server_error` in two mappers and `unknown` in two others.
 *
 * This is the test the DRY finding asked for: it is table-driven over BOTH axes,
 * so the next status added to `httpStatusToErrorCode` is proven to reach every
 * provider rather than one. A new mapper is one row in PROVIDERS; a new status is
 * one row in STATUSES. Neither can be added while quietly skipping the other.
 *
 * Every case passes an EMPTY body on purpose. The vendor body classifiers are
 * real per-vendor contracts and are tested in their own files; what is under test
 * here is the fallback they share, and a body would let a vendor rule answer first
 * and hide a drifted ladder.
 */
import { describe, expect, it } from "vitest";

import type { TheokitAgentError } from "../../../src/errors.js";
import { mapAnthropicError } from "../../../src/internal/error-mappers/anthropic.js";
import { mapBedrockError } from "../../../src/internal/error-mappers/bedrock.js";
import { mapOpenAICompatibleError } from "../../../src/internal/error-mappers/openai-compatible.js";
import { httpStatusToErrorCode } from "../../../src/internal/error-mappers/shared.js";
import { mapVertexError } from "../../../src/internal/error-mappers/vertex.js";

const PROVIDERS: ReadonlyArray<{ name: string; map: (status: number) => TheokitAgentError }> = [
  {
    name: "anthropic",
    map: (status) =>
      mapAnthropicError({ status, body: {}, headers: new Headers(), endpoint: "/v1/messages" }),
  },
  {
    name: "openai-compatible",
    map: (status) =>
      mapOpenAICompatibleError({
        providerId: "openai",
        status,
        body: {},
        headers: new Headers(),
        endpoint: "/v1/chat/completions",
      }),
  },
  {
    name: "bedrock",
    map: (status) =>
      mapBedrockError({ status, body: {}, headers: new Headers(), endpoint: "/invoke" }),
  },
  {
    name: "vertex",
    map: (status) =>
      mapVertexError({ status, body: {}, headers: new Headers(), endpoint: "/generateContent" }),
  },
];

/**
 * The expected answers, written out RATHER THAN DERIVED from the function under test.
 *
 * The first version of this file computed `expected` by calling
 * `httpStatusToErrorCode(status)` and then asserted each provider matched it. That
 * detects provider drift and NOTHING ELSE: mutate the ladder and both sides of the
 * comparison move together, so every provider row stays green over a changed
 * contract. Measured — mutating `402 -> quota_exceeded` into `402 -> invalid_request`
 * failed one assertion out of 52, and all sixteen 402 provider rows passed.
 *
 * That is a weaker instance of the exact defect this audit kept finding elsewhere: a
 * check that cannot fail over the thing it appears to guard. An explicit table pins
 * BOTH axes — the ladder's own values and every provider's agreement with them.
 */
const EXPECTED: ReadonlyArray<readonly [status: number, code: string]> = [
  [400, "invalid_request"],
  [401, "auth_failed"],
  [402, "quota_exceeded"], // reached one mapper of four before the ladder was shared
  [403, "auth_failed"],
  [408, "timeout"],
  [429, "rate_limit"],
  [500, "server_error"],
  [503, "server_error"],
  [599, "server_error"], // last real server status
  [600, "unknown"], // not a status at all — two mappers used to call it server_error
];

describe("httpStatusToErrorCode — the single definition", () => {
  it.each(EXPECTED)("classifies HTTP %i as %s", (status, code) => {
    expect(httpStatusToErrorCode(status)).toBe(code);
  });
});

describe("every provider mapper honours the shared ladder", () => {
  for (const provider of PROVIDERS) {
    for (const [status, expected] of EXPECTED) {
      it(`${provider.name} maps HTTP ${status} to ${expected}`, () => {
        const err = provider.map(status);
        expect(
          err.metadata?.code,
          `${provider.name} disagrees with the shared ladder on HTTP ${status}. ` +
            "A mapper that answers differently from the ladder with no body to justify it " +
            "is a drifted copy, which is the defect this file exists to catch.",
        ).toBe(expected);
      });
    }
  }
});
