/**
 * AgentMailbox — per-agent inbox for A2A communication (T20.1, ADR D453).
 *
 * Wraps MessageBus registration with a convenient API for sending,
 * receiving, and requesting messages.
 *
 * @public
 */

import type { MessageBus, RequestOptions } from "./message-bus.js";
import type { A2AMessage, MessageHandler } from "./types.js";

/**
 * One agent's endpoint on a {@link MessageBus}: registers `agentId` on
 * construction and forwards inbound messages to the handler installed by
 * `onMessage`.
 *
 *   const mailbox = new AgentMailbox("worker", bus);
 *   mailbox.onMessage((m) => `echo:${m.payload}`);
 *   await mailbox.send("boss", { type: "ready", payload: null });
 *
 * Needs an already-constructed `MessageBus` — the mailbox does not create one, and
 * two mailboxes reach each other only through the SAME bus instance.
 *
 * How it fails: `send` and `request` are thin forwards, so they carry the bus's
 * failures unchanged (plain `Error` for an unregistered peer, plus a timeout
 * rejection for `request`).
 *
 * Traps:
 *  - The constructor registers IMMEDIATELY, before `onMessage` can be called. A
 *    message arriving in that window is dropped silently, and a peer's `request`
 *    RESOLVES WITH `undefined` instead of timing out — install the handler in the
 *    same tick as construction.
 *  - Constructing a second mailbox with the same `agentId` on the same bus takes
 *    the id over silently (`MessageBus.register` overwrites), and the loser's
 *    `dispose()` then unregisters the WINNER.
 *  - `dispose()` only unregisters and clears the handler. Requests already in
 *    flight are neither cancelled nor rejected; they time out on the caller's side.
 */
export class AgentMailbox {
  readonly agentId: string;
  private readonly _bus: MessageBus;
  private _handler: MessageHandler | null = null;

  constructor(agentId: string, bus: MessageBus) {
    this.agentId = agentId;
    this._bus = bus;
    this._bus.register(agentId, (msg) => this._dispatch(msg));
  }

  onMessage(handler: MessageHandler): void {
    this._handler = handler;
  }

  async send(to: string, partial: { type: string; payload: unknown }): Promise<void> {
    return this._bus.send(this.agentId, to, partial);
  }

  async request(
    to: string,
    partial: { type: string; payload: unknown },
    opts?: RequestOptions,
  ): Promise<unknown> {
    return this._bus.request(this.agentId, to, partial, opts);
  }

  dispose(): void {
    this._bus.unregister(this.agentId);
    this._handler = null;
  }

  private _dispatch(msg: A2AMessage): unknown {
    if (this._handler) {
      return this._handler(msg);
    }
  }
}
