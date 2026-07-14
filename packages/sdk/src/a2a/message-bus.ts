/**
 * MessageBus — in-process typed message router for A2A (T20.1, ADR D453).
 *
 * Routes messages between agents by ID. Supports fire-and-forget (send)
 * and request/response (request with timeout).
 *
 * @public
 */

import type { A2AMessage, MessageHandler } from "./types.js";

export interface RequestOptions {
  timeoutMs?: number;
}

export class MessageBus {
  private readonly _handlers = new Map<string, MessageHandler>();

  register(agentId: string, handler: MessageHandler): void {
    this._handlers.set(agentId, handler);
  }

  unregister(agentId: string): void {
    this._handlers.delete(agentId);
  }

  async send(from: string, to: string, partial: { type: string; payload: unknown }): Promise<void> {
    const handler = this._handlers.get(to);
    if (!handler) {
      throw new Error(`Agent "${to}" not registered on MessageBus`);
    }
    const message: A2AMessage = {
      ...partial,
      from,
      to,
      timestamp: Date.now(),
      // SE3 — provenance projection of the sender address (thin view over `from`).
      origin: { kind: "peer", from },
    };
    // Fire-and-forget: invoke handler but don't await result
    handler(message);
  }

  async request(
    from: string,
    to: string,
    partial: { type: string; payload: unknown },
    opts?: RequestOptions,
  ): Promise<unknown> {
    const handler = this._handlers.get(to);
    if (!handler) {
      throw new Error(`Agent "${to}" not registered on MessageBus`);
    }
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const message: A2AMessage = {
      ...partial,
      from,
      to,
      timestamp: Date.now(),
      // SE3 — provenance projection of the sender address (thin view over `from`).
      origin: { kind: "peer", from },
    };
    // Hold the timer so it can be cleared once the race settles — otherwise a
    // successful request leaks a live `setTimeout` that keeps the Node event loop
    // alive (the process hangs after the reply). Cleared in `finally`.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(handler(message)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`A2A request timeout: ${to} did not respond within ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  has(agentId: string): boolean {
    return this._handlers.has(agentId);
  }

  listAgents(): string[] {
    return [...this._handlers.keys()];
  }
}
