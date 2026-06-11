/**
 * `EventBus` — typed EventEmitter wrapper.
 *
 * Provides type-safe publish/subscribe with automatic unsubscribe cleanup.
 * Each handler is try-caught (EC-2) so one failing handler cannot break others.
 */

type EventHandler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<EventHandler<never>>>();

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
      } catch {
        // EC-2: swallow per-handler errors so other handlers still fire
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
