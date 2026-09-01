/**
 * Typed error classes — `@theokit/sdk/server/auth`.
 *
 * Plan T1.2 + v1.1 EC-1 (AuthCancelledError for OAuth provider error response RFC 6749 §4.1.2.1).
 */

import { TheokitAgentError } from "../../errors.js";

/**
 * Thrown at `defineAuth()` time when configuration is invalid
 * (e.g., duplicate provider name, invalid email shape per EC-V1-12).
 */
export class AuthConfigError extends TheokitAgentError {
  override readonly name = "AuthConfigError";
  override readonly code: string;

  constructor(code: string, message: string) {
    // Not retryable: a misconfiguration is fixed by an operator, not by trying again.
    super(`[${code}] ${message}`, { code, isRetryable: false });
    this.code = code;
  }
}

/**
 * Thrown at `startSignIn(providerName, ...)` or `finishSignIn(providerName, ...)`
 * when the named provider is not registered in `providers[]`.
 */
export class AuthProviderNotFoundError extends TheokitAgentError {
  override readonly name = "AuthProviderNotFoundError";
  readonly providerName: string;

  constructor(providerName: string) {
    // Not retryable: the provider is absent from the configuration until someone adds it.
    super(
      `Auth provider not found: '${providerName}'. Register it in defineAuth({ providers: [...] }).`,
      { code: "auth_provider_not_found", isRetryable: false },
    );
    this.providerName = providerName;
  }
}

/**
 * Thrown during OAuth callback handling for state mismatches, expired
 * transactions, missing query params, or provider 4xx/5xx errors.
 *
 * Typed `code` field lets consumers branch on cause:
 *   - 'oauth_transaction_expired' — cookie tx > 10min old (per ADR D5)
 *   - 'oauth_state_mismatch' — query state ≠ cookie state (CSRF defense per RFC 6749 §10.12)
 *   - 'oauth_provider_error' — non-access_denied error in callback URL
 *   - 'oauth_token_exchange_failed' — provider rejected code-for-tokens swap
 *   - 'oauth_userinfo_failed' — userinfo endpoint returned error
 *   - 'oauth_missing_code_or_state' — required query params absent
 */
export class AuthCallbackError extends TheokitAgentError {
  // Widened to string on purpose: AuthCancelledError below narrows it to its own name.
  override readonly name: string = "AuthCallbackError";
  override readonly code: string;

  constructor(code: string, message?: string) {
    // Not retryable here: the code comes from the provider on a callback that already happened;
    // recovering means restarting the flow, not re-throwing the same callback.
    super(message ?? `OAuth callback error: ${code}`, { code, isRetryable: false });
    this.code = code;
  }
}

/**
 * Per v1.1 EC-1 MUST FIX — typed subclass of AuthCallbackError for the
 * specific case where user declined consent at provider screen.
 *
 * OAuth 2.0 RFC 6749 §4.1.2.1: provider redirects with `?error=access_denied`.
 * Apps can catch this distinctly from network/server errors to render
 * "Login cancelled — try again" UX instead of opaque "callback failed".
 */
export class AuthCancelledError extends AuthCallbackError {
  override readonly name: string = "AuthCancelledError";
  readonly errorDescription?: string;

  constructor(errorDescription?: string) {
    super("user_declined_consent", errorDescription ?? "User declined consent at provider");
    this.errorDescription = errorDescription;
  }
}
