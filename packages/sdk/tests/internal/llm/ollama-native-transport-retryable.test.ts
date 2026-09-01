/**
 * A transport failure from the Ollama native client must be RETRYABLE.
 *
 * This is mechanical, not stylistic. `isTransientError` (errors.ts:442) is
 * `err instanceof TheokitAgentError && err.isRetryable === true`, and `router.ts` wraps every
 * resolved client in `RetryingLlmClient`. So an error that is not in the SDK hierarchy is
 * NON-TRANSIENT BY CONTRACT and is never retried — a dropped connection to a local Ollama, the most
 * ordinary transient failure there is, would surface to the caller on the first attempt.
 *
 * `openai.ts:183-185` records this exact bug being found and fixed for the other transports, in the
 * repository's own words: *"before this, a raw `throw fetchErr` left here for every provider other
 * than Ollama, and a foreign error is NON-transient by contract: retry stayed off in the most
 * classic case."* The knowledge was extracted into `wrapTransportError` and applied to two
 * transports. Ollama — the one that comment names as the exception — still threw raw, and the
 * non-ok branch below it threw a bare `new Error`, which is equally outside the hierarchy.
 *
 * Both paths are asserted here because both produce the same silent non-retry.
 */
import { describe, expect, it } from "vitest";

import { isTransientError, type NetworkError, TheokitAgentError } from "../../../src/errors.js";
import { OllamaNativeClient } from "../../../src/internal/llm/ollama-native.js";
import type { LlmRequest } from "../../../src/internal/llm/types.js";

const REQUEST: LlmRequest = {
  model: "llama3",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

async function drain(client: OllamaNativeClient): Promise<unknown> {
  const it = client.stream(REQUEST, new AbortController().signal);
  // The first `next()` is what performs the fetch.
  await it.next();
  return undefined;
}

describe("OllamaNativeClient transport failures stay inside the SDK error hierarchy", () => {
  it("a dropped connection surfaces as a retryable NetworkError, not a raw fetch error", async () => {
    const client = new OllamaNativeClient({
      baseUrl: "http://127.0.0.1:1",
      fetch: (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
    });

    const err = await drain(client).catch((e: unknown) => e);
    expect(err, "the stream must reject").toBeInstanceOf(Error);
    expect(
      err,
      "a raw undici error is outside the hierarchy, so RetryingLlmClient will not retry it — " +
        "which is the defect openai.ts:183 records having fixed for every other transport",
    ).toBeInstanceOf(TheokitAgentError);
    expect(isTransientError(err)).toBe(true);
    expect((err as NetworkError).code).toBe("transport_failure");
  });

  it("an unmapped non-ok status surfaces as a typed error, not a bare Error", async () => {
    // 418 is deliberately outside every arm of the Ollama body mapper, so this exercises the
    // fallthrough that used to `throw new Error(...)`.
    const client = new OllamaNativeClient({
      baseUrl: "http://127.0.0.1:1",
      fetch: (() =>
        Promise.resolve(
          new Response("teapot", { status: 418, statusText: "I'm a teapot" }),
        )) as unknown as typeof fetch,
    });

    const err = await drain(client).catch((e: unknown) => e);
    expect(
      err,
      "a bare `new Error` is outside the hierarchy exactly like a raw fetch error is",
    ).toBeInstanceOf(TheokitAgentError);
    expect(String((err as Error).message)).toContain("418");
  });

  it("an AbortError is passed through unchanged", async () => {
    // wrapTransportError returns AbortError untouched on purpose: a caller-initiated cancellation
    // is not a transport failure and must not become retryable.
    const abort = new DOMException("aborted", "AbortError");
    const client = new OllamaNativeClient({
      baseUrl: "http://127.0.0.1:1",
      fetch: (() => Promise.reject(abort)) as unknown as typeof fetch,
    });

    const err = await drain(client).catch((e: unknown) => e);
    expect(err).toBe(abort);
    expect(isTransientError(err)).toBe(false);
  });
});
