/**
 * MessageBus — in-process typed message router for A2A (T20.1, ADR D453).
 *
 * Routes messages between agents by ID. Supports fire-and-forget (send)
 * and request/response (request with timeout).
 *
 * @public
 */

import { diag } from "../internal/diagnostics.js";
import type { A2AMessage, MessageHandler } from "./types.js";

/**
 * A peer did not answer a {@link MessageBus.request} within its timeout.
 *
 * Carries `code: "a2a_request_timeout"`, the peer's address and the limit as FIELDS, so a caller
 * branches on the contract rather than on prose — `docs/error-codes.md`: "Branch on `code`, never
 * on the message: messages carry context (an id, a path, a limit) and change with it, while a code
 * is the contract." Until #380 this rejection was a plain `Error` with neither, and the message it
 * carried embeds both the address and the limit, so matching on it changed with context exactly as
 * that document warns.
 *
 * The distinction it restores is what a retry policy is built on. A peer that did not answer in
 * time is transient and worth retrying; a peer whose handler threw is likely deterministic and
 * retrying repeats the failure. A handler's own error propagates unchanged and is NOT this type —
 * an unattended agent can therefore tell the two apart without reading English.
 *
 * @public
 */
export class A2ARequestTimeoutError extends Error {
  readonly code = "a2a_request_timeout" as const;
  constructor(
    /** The peer that did not answer. */
    public readonly to: string,
    /** The limit it exceeded, in milliseconds. */
    public readonly timeoutMs: number,
  ) {
    super(`A2A request timeout: ${to} did not respond within ${timeoutMs}ms`);
    this.name = "A2ARequestTimeoutError";
  }
}

/**
 * Per-call knobs for {@link MessageBus.request} / `AgentMailbox.request`.
 */
export interface RequestOptions {
  /**
   * How long to wait for the peer handler to settle before rejecting.
   * Default `30_000` (30 s). The rejection is an {@link A2ARequestTimeoutError} carrying
   * `code: "a2a_request_timeout"`, `to` and `timeoutMs` (#380), so a caller distinguishes a
   * timeout from a handler failure by branching on the code — a handler's own error propagates
   * unchanged and is not that type.
   */
  timeoutMs?: number;
}

/**
 * In-process router that delivers A2A messages between agents keyed by string id.
 *
 * Purely in-memory and single-process: nothing is persisted and nothing crosses a
 * process or network boundary. Register one handler per agent id, then `send`
 * (fire-and-forget) or `request` (await the handler's return value).
 *
 *   const bus = new MessageBus();
 *   bus.register("worker", (m) => `echo:${m.payload}`);
 *   const reply = await bus.request("boss", "worker", { type: "ping", payload: 1 });
 *
 * Callers supply only `{ type, payload }`; the bus stamps `from`, `to`,
 * `timestamp` and `origin` onto the delivered {@link A2AMessage}.
 *
 * How it fails: `send` and `request` both reject with a plain `Error`
 * (`Agent "<to>" not registered on MessageBus`) when `to` has no handler, and
 * `request` additionally rejects on timeout. No typed error class is exported for
 * either, so there is nothing to `instanceof`.
 *
 * Traps:
 *  - `register` silently OVERWRITES an existing id; the previous handler simply
 *    stops receiving anything. Call `has(id)` first when that matters.
 *  - `send` is declared `async` but never awaits the handler. A handler that
 *    rejects produces an UNHANDLED rejection that `await bus.send(...)` does not
 *    observe — only the "not registered" failure reaches the caller. Use
 *    `request` when the handler's failure has to be visible.
 *  - `from` is whatever the caller passes; the bus never checks that the sender
 *    is registered. It is self-asserted provenance, not authentication.
 */
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
    // Fire-and-forget: the SENDER does not wait for the result, which is the whole point of
    // `send`. It does not mean nobody is told when delivery fails — that is the difference
    // between asynchronous and silent (#365).
    //
    // The returned promise used to be dropped on the floor. `MessageHandler` may return one, so a
    // rejecting handler became an unhandled rejection: fatal under Node's default
    // `--unhandled-rejections=throw`, and invisible to the caller, whose `await send(...)`
    // resolved cleanly either way. Attaching a catch keeps the call non-blocking and reports the
    // failure instead of discarding it (`error-handling.md` § 5).
    void Promise.resolve(handler(message)).catch((cause: unknown) => {
      const reason = cause instanceof Error ? cause.message : String(cause);
      diag(`[theokit-sdk] a2a: handler for "${to}" failed on a fire-and-forget send: ${reason}\n`);
    });
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
          timer = setTimeout(() => reject(new A2ARequestTimeoutError(to, timeoutMs)), timeoutMs);
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
