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
