/**
 * B-012 — `wrapTransportError` is the entire socket-failure path of both main LLM providers
 * (`anthropic.ts:147`, `openai.ts:186`) and nothing entered it.
 *
 * Measured before writing these: removing the wrap and running the whole `tests/internal/` +
 * `tests/golden/` tree produced zero failures. The item said the path is never exercised; it was
 * right.
 *
 * Scope, stated so it is not mistaken for more: these tests prove the WRAPPER behaves. They do NOT
 * prove the providers call it — a passing wrapper can coexist with a provider that never invokes it
 * on a socket failure. That wiring is a recorded followup, not an implication of this file.
 */

import { describe, expect, it } from "vitest";

import { NetworkError } from "../../../src/errors.js";
import { wrapTransportError } from "../../../src/internal/llm/transport-error.js";

const CTX = { providerId: "anthropic", endpoint: "/v1/messages" };

describe("wrapTransportError", () => {
  it("test_an_abort_passes_through_unwrapped", () => {
    // An AbortError means the CALLER cancelled. Wrapping it in a NetworkError would mark a
    // deliberate cancellation as retryable, and the retry layer would then re-issue a request the
    // caller already abandoned.
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

    expect(
      wrapTransportError(abort, CTX),
      "an abort must not be reclassified as a network fault",
    ).toBe(abort);
  });

  it("test_a_timeout_passes_through_unwrapped", () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });

    expect(wrapTransportError(timeout, CTX)).toBe(timeout);
  });

  it("test_an_already_wrapped_error_is_not_wrapped_twice", () => {
    const already = new NetworkError("upstream reset", { code: "transport_failure" });

    expect(wrapTransportError(already, CTX), "double wrapping would bury the original cause").toBe(
      already,
    );
  });

  it("test_a_socket_failure_becomes_a_typed_NetworkError_that_keeps_its_cause", () => {
    const socket = new Error("ECONNRESET");

    const wrapped = wrapTransportError(socket, CTX);

    expect(wrapped, "a raw socket failure must become a typed SDK error").toBeInstanceOf(
      NetworkError,
    );
    // The `code` is asserted, not just the class: `NetworkError` is thrown from several places and
    // the class alone does not say this one came from the transport.
    expect((wrapped as NetworkError & { code?: string }).code).toBe("transport_failure");
    // Cause preservation is the property that makes the wrap worth doing — without it the original
    // stack is gone and an ECONNRESET is indistinguishable from a DNS failure in the logs.
    expect((wrapped as NetworkError).cause, "the original error must survive the wrap").toBe(
      socket,
    );
    expect((wrapped as NetworkError).message).toContain("anthropic");
    expect((wrapped as NetworkError).message).toContain("/v1/messages");
  });

  it("test_a_non_error_throwable_is_still_wrapped_with_its_text", () => {
    // `fetch` can reject with a non-Error in exotic runtimes; the wrapper stringifies rather than
    // producing "[object Object]" or dropping the detail.
    const wrapped = wrapTransportError("socket hang up", CTX) as NetworkError;

    expect(wrapped).toBeInstanceOf(NetworkError);
    expect(wrapped.message).toContain("socket hang up");
  });
});
