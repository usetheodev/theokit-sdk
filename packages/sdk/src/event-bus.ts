/**
 * `EventBus` — typed EventEmitter wrapper.
 *
 * Provides type-safe publish/subscribe with automatic unsubscribe cleanup.
 * Each handler is try-caught (EC-2) so one failing handler cannot break others.
 */

import { diag } from "./internal/diagnostics.js";

type EventHandler<T> = (payload: T) => void;

/**
 * A typed publish/subscribe bus, parameterised by a map of event name to payload type.
 *
 * `publish` is SYNCHRONOUS: handlers run in subscription order before it returns, so a slow handler
 * blocks the publisher. Each handler is invoked inside its own try/catch, so one that throws cannot
 * stop the others — the error is written to the diagnostics channel and counted on
 * `handlerErrorCount`. Assert on that counter in tests; a subscriber failing on every event is
 * otherwise invisible.
 *
 * `subscribe` returns the unsubscribe function, which is the only way to detach a handler — there
 * is no `off` taking the handler back. Handlers are held in a `Set` per event, so subscribing the
 * same function reference twice registers it once.
 *
 * Payload objects are passed by reference to every handler; nothing here copies them, so a handler
 * that mutates a payload mutates it for the handlers after it.
 */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<EventHandler<never>>>();
  // M3 #64 — a swallowed handler error used to vanish without a trace (fail-loud
  // violation). We now log it AND expose an observable count so ops/tests can see
  // that a subscriber is silently failing, without breaking the EC-2 contract.
  #handlerErrorCount = 0;

  /** M3 #64 — number of handler invocations that threw (and were logged). */
  get handlerErrorCount(): number {
    return this.#handlerErrorCount;
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  subscribe<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as EventHandler<never>);
    return () => {
      set.delete(handler as EventHandler<never>);
    };
  }

  /**
   * Publish an event to all subscribers. EC-2: try-catch per handler.
   */
  publish<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as EventHandler<Events[K]>)(payload);
      } catch (cause) {
        // EC-2: an error in one handler MUST NOT break the others — but M3 #64
        // makes it fail-loud: log with the event key + message and count it,
        // instead of the pre-M3 empty catch that discarded it without a trace.
        this.#handlerErrorCount += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        // theokit#147 — through the interceptable channel, not straight at the terminal: a TUI
        // host installs a diagnostics sink precisely so a stray write cannot corrupt its frame.
        diag(`[theokit-sdk] event-bus: handler for "${String(event)}" threw: ${message}\n`);
      }
    }
  }

  /**
   * Subscribe to an event for a single firing. Returns an unsubscribe function.
   */
  once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    const wrapped: EventHandler<Events[K]> = (payload) => {
      unsub();
      handler(payload);
    };
    const unsub = this.subscribe(event, wrapped);
    return unsub;
  }
}
