/**
 * @theokit/sdk/server/auth — public barrel
 *
 * Per ADR D6 (sub-path export) — consumers import via `@theokit/sdk/server/auth`
 * NOT main `@theokit/sdk` barrel. Tree-shaking + allows breaking changes in
 * auth surface without affecting Agent runtime consumers.
 *
 * T1.1 ships types-only. T1.2 adds defineAuth() runtime + error classes.
 */

export type {
  AuthOrchestrator,
  AuthProvider,
  AuthResult,
  DefineAuthOptions,
  OAuthTransaction,
  SessionManager,
} from "./types.js";
