import type { RunOperation } from "./types/run.js";

/**
 * Base class for all errors thrown by `@usetheo/sdk`.
 *
 * Use `isRetryable` to drive retry/backoff logic. `code` and `protoErrorCode`
 * are populated for server-originated errors when available.
 *
 * @public
 */
export class TheokitAgentError extends Error {
  override readonly name: string = "TheokitAgentError";
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly protoErrorCode?: string;

  constructor(
    message: string,
    options: {
      isRetryable?: boolean;
      code?: string;
      protoErrorCode?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.isRetryable = options.isRetryable ?? false;
    if (options.code !== undefined) this.code = options.code;
    if (options.protoErrorCode !== undefined) this.protoErrorCode = options.protoErrorCode;
  }
}

/**
 * Invalid API key, not logged in, insufficient permissions.
 *
 * @public
 */
export class AuthenticationError extends TheokitAgentError {
  override readonly name: string = "AuthenticationError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Too many requests or usage limits exceeded.
 *
 * @public
 */
export class RateLimitError extends TheokitAgentError {
  override readonly name: string = "RateLimitError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: true });
  }
}

/**
 * Invalid model, bad request parameters, malformed options.
 *
 * @public
 */
export class ConfigurationError extends TheokitAgentError {
  override readonly name: string = "ConfigurationError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Thrown when creating a cloud agent for a repo whose SCM provider is not
 * connected. Use `helpUrl` to point the user at the right reconnect flow.
 *
 * @public
 */
export class IntegrationNotConnectedError extends ConfigurationError {
  override readonly name: string = "IntegrationNotConnectedError";
  readonly provider: string;
  readonly helpUrl: string;

  constructor(
    message: string,
    options: { provider: string; helpUrl: string; code?: string; cause?: unknown },
  ) {
    super(message, options);
    this.provider = options.provider;
    this.helpUrl = options.helpUrl;
  }
}

/**
 * Service unavailable, timeout, transport-level failure.
 *
 * @public
 */
export class NetworkError extends TheokitAgentError {
  override readonly name: string = "NetworkError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: true });
  }
}

/**
 * Catch-all for unclassified server or runtime errors.
 *
 * @public
 */
export class UnknownAgentError extends TheokitAgentError {
  override readonly name: string = "UnknownAgentError";

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { ...options, isRetryable: false });
  }
}

/**
 * Thrown when a {@link Run} operation is not available on the current runtime.
 * Check first with `run.supports(operation)`.
 *
 * @public
 */
export class UnsupportedRunOperationError extends Error {
  override readonly name: string = "UnsupportedRunOperationError";
  readonly operation: RunOperation;

  constructor(message: string, operation: RunOperation) {
    super(message);
    this.operation = operation;
  }
}
