/**
 * A2A (Agent-to-Agent) communication types (T20.1, ADR D453).
 * @public
 */

export interface A2AMessage<T = unknown> {
  type: string;
  payload: T;
  from: string;
  to: string;
  timestamp: number;
}

export type MessageHandler<T = unknown> = (
  message: A2AMessage<T>,
) => undefined | unknown | Promise<undefined | unknown>;
