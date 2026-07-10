/**
 * A2A (Agent-to-Agent) communication types (T20.1, ADR D453).
 * @public
 */

import type { MessageOrigin } from "../types/run.js";

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

export type MessageHandler<T = unknown> = (
  message: A2AMessage<T>,
) => undefined | unknown | Promise<undefined | unknown>;
