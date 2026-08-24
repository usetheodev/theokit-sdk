/**
 * Typed error classes — `@theokit/sdk/server/auth`.
 *
 * Plan T1.2 + v1.1 EC-1 (AuthCancelledError for OAuth provider error response RFC 6749 §4.1.2.1).
 */

/**
 * Thrown at `defineAuth()` time when configuration is invalid
 * (e.g., duplicate provider name, invalid email shape per EC-V1-12).
 */
export class AuthConfigError extends Error {
  override readonly name = "AuthConfigError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

/**
 * Thrown at `startSignIn(providerName, ...)` or `finishSignIn(providerName, ...)`
 * when the named provider is not registered in `providers[]`.
 */
export class AuthProviderNotFoundError extends Error {
  override readonly name = "AuthProviderNotFoundError";
  readonly providerName: string;

  constructor(providerName: string) {
    super(
      `Auth provider not found: '${providerName}'. Register it in defineAuth({ providers: [...] }).`,
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
export class AuthCallbackError extends Error {
  override readonly name: string = "AuthCallbackError";
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `OAuth callback error: ${code}`);
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
