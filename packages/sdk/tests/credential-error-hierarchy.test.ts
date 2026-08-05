/**
 * M78 T1.1 — `CredentialError` entra na hierarquia tipada do SDK.
 *
 * ## A cadeia causal que este teste fecha
 *
 * `isTransientError` is `err instanceof TheokitAgentError && err.isRetryable === true`
 * (`src/errors.ts:443`). `CredentialError` estendia `Error` NU
 * (`src/internal/auth/credential-store.ts:58`), so **no credential error could ever be
 * classified** — neither as transient nor as permanent. The predicate was not "forgotten" by the
 * consumer: it was useless there by construction.
 *
 * ## Why in the SDK, and not in the consumer
 *
 * O agent-builder importa `CredentialError` da camada desde o M73
 * (`agents/lib/auth/credentials.ts:90`) — it does not own the class and cannot reparent it. The ROADMAP's
 * DoD frames this as consumer-side work; measurement showed it is not.
 *
 * ## What the single reference does
 *
 * O Codex tem UMA enum raiz — `CodexErr` (`protocol/src/error.rs:176`) — com `is_retryable()` como
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

describe("M78 T1.1 — CredentialError na hierarquia tipada", () => {
  it("test_CredentialError_e_um_TheokitAgentError", () => {
    // Two levels up: CredentialError -> AuthenticationError -> TheokitAgentError.
    const err = new CredentialError("missing key");
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("test_CredentialError_continua_sendo_ELA_MESMA", () => {
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
    expect(isTransientError(new CredentialError("revogada"))).toBe(false);
  });

  it("test_um_catch_generico_discrimina_framework_de_app_com_UM_instanceof", () => {
    // The milestone's DoD 5, proven where it originates. Before, a `catch` received a bare `Error` from the
    // store e `Error` nu vindo do app, sem forma de distinguir sem comparar strings de `name`.
    const doFramework: unknown = new CredentialError("do store");
    const doApp: unknown = new Error("do app");

    expect(doFramework instanceof TheokitAgentError).toBe(true);
    expect(doApp instanceof TheokitAgentError).toBe(false);
  });
});
