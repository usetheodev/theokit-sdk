/**
 * @theokit/sdk/server/auth — public barrel
 *
 * Per ADR D6 (sub-path export) — consumers import via `@theokit/sdk/server/auth`
 * NOT main `@theokit/sdk` barrel. Tree-shaking + allows breaking changes in
 * auth surface without affecting Agent runtime consumers.
 *
 * T1.1 shipped types-only.
 * T1.2 adds runtime: defineAuth() + 4 typed error classes + validateReturnTo helper.
 */

export {
  AuthCallbackError,
  AuthCancelledError,
  AuthConfigError,
  AuthProviderNotFoundError,
} from "./errors.js";

export { defineAuth } from "./orchestrator.js";
export type {
  AuthOrchestrator,
  AuthProvider,
  AuthResult,
  DefineAuthOptions,
  OAuthTransaction,
  SessionManager,
} from "./types.js";
export { validateReturnTo } from "./validate-return-to.js";
