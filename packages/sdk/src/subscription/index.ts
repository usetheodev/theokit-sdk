/**
 * @theokit/sdk — Subscription public barrel (G8 v1.7.0).
 *
 * Per ADRs D422-D429 (Form 4 Hybrid + DSL + transport + resume).
 *
 * Exports:
 * - `defineSubscription` — server-side typed RPC subscription factory
 * - `tracked`, `isTrackedEnvelope` — resume token envelope helpers
 * - `subscribe` — client-side AsyncGenerator (also reachable via `Theokit.subscribe`)
 * - Types: `SubscriptionCtx`, `SubscriptionDescriptor`, `SubscriptionTransport`,
 *   `TrackedEnvelope`, `SubscribeOptions`, `DefineSubscriptionOptions`
 * - Errors: `SubscriptionError`, `SubscriptionInputError`, `SubscriptionDisconnectError`
 *
 * @public
 */

export {
  defineSubscription,
  type DefineSubscriptionOptions,
} from "./define-subscription.js";

export {
  isTrackedEnvelope,
  SubscriptionDisconnectError,
  SubscriptionError,
  SubscriptionInputError,
  tracked,
  type SubscriptionCtx,
  type SubscriptionDescriptor,
  type SubscriptionTransport,
  type TrackedEnvelope,
} from "./types.js";

export { subscribe, type SubscribeOptions } from "./theokit-subscribe.js";
