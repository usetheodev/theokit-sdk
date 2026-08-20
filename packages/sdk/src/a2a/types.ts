/**
 * A2A (Agent-to-Agent) communication types (T20.1, ADR D453).
 * @public
 */

import type { MessageOrigin } from "../types/run.js";

/**
 * One message as a handler receives it.
 *
 * Senders never build this value: `MessageBus.send` / `MessageBus.request` accept
 * only `{ type, payload }` and fill in `from`, `to`, `timestamp` (`Date.now()`)
 * and `origin` themselves.
 *
 * `type` is a free-form string with no registry — sender and handler must agree on
 * it out of band, and an unrecognised `type` is delivered like any other rather
 * than rejected.
 *
 * The `T` parameter types `payload` only. The bus itself is untyped (both entry
 * points take `payload: unknown`), so declaring `MessageHandler<Foo>` is an
 * assertion rather than a validated cast — parse `payload` before trusting it.
 */
export interface A2AMessage<T = unknown> {
  type: string;
  payload: T;
  from: string;
  to: string;
  timestamp: number;
  /**
   * SE3 — provenance projection of the sender address: `{ kind: "peer", from }`.
   * A thin view over `from` (not a parallel system), so a receiver that turns an
   * a2a message into a turn can forward it via `SendOptions.origin`.
   */
  origin?: MessageOrigin;
}

/**
 * What an agent does with an inbound {@link A2AMessage}.
 *
 * The return value is the REPLY that `MessageBus.request` resolves with (awaited
 * when it is a promise) and is DISCARDED by `MessageBus.send`. Returning
 * `undefined` is indistinguishable, at the requester, from a handler that
 * deliberately answered `undefined`.
 *
 * Throwing rejects the pending `request`. Under `send` the same throw becomes an
 * unhandled rejection nobody observes — see {@link MessageBus}.
 */
export type MessageHandler<T = unknown> = (
  message: A2AMessage<T>,
) => undefined | unknown | Promise<undefined | unknown>;
