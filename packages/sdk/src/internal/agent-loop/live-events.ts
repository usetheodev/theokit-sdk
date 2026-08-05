import type { SDKMessage } from "../../types/messages.js";

/**
 * theokit#140 — the loop's event log, reporting each event AS IT HAPPENS.
 *
 * ## The defect this closes
 *
 * `runAgentLoop` collected events into a plain array and returned it, so nothing reached the run
 * until the loop had finished. `RealLocalRun.applyAgentLoopOutput` then copied the whole batch in
 * one pass. Meanwhile `SendOptions.onDelta` fired live from inside that same loop.
 *
 * Two clocks, one of which does not start until the other has stopped. A consumer that wanted tool
 * calls interleaved with tokens in true order had to fuse both surfaces itself — which is exactly
 * what `@theokit/agents` was doing, and the documented root of its ordering bug (theokit#47), its
 * namespace-dedup bug (theokit#138) and its missing terminal frame (theokit#142).
 *
 * ## Why a subclass, and not a callback threaded through nine call sites
 *
 * The events are appended from nine places across `loop.ts`, `loop-llm-stream.ts` and
 * `tool-dispatch.ts`. Threading an `onEvent` parameter to each would touch every one of them and,
 * worse, would leave the NEXT `events.push(...)` silently un-notified — a defect that reintroduces
 * itself by omission, which is the failure mode this whole issue is about.
 *
 * Extending `Array` moves the decision to the single place the log is CREATED. Every existing push
 * becomes live with no call-site change, and any push added later is live for free.
 *
 * It stays a real `Array`: `AgentLoopOutput.events` is still `SDKMessage[]`, `instanceof Array`
 * still holds, and every downstream consumer — including the batch copy in `applyAgentLoopOutput` —
 * is unchanged. This is additive; nothing that worked before observes a difference.
 *
 * `push` is the only override, deliberately. The loop only ever appends; overriding the rest of the
 * mutation surface would be guarding against callers that do not exist (YAGNI), and a subscriber
 * that must reason about splices is a worse contract than one that receives appends.
 */
export class LiveEventLog extends Array<SDKMessage> {
  /**
   * Not readonly, and not a constructor parameter — `Array` subclasses are re-instantiated by
   * `map`/`filter`/`slice` with a length argument, so a constructor with a different signature
   * breaks those. The sink is attached after construction instead.
   */
  #sink: ((event: SDKMessage) => void) | undefined;

  /** Attach the live subscriber. One sink: the run that owns this loop. */
  subscribe(sink: (event: SDKMessage) => void): void {
    this.#sink = sink;
  }

  override push(...events: SDKMessage[]): number {
    const length = super.push(...events);
    for (const event of events) {
      // A throwing subscriber must not take down the agent loop: the sink is an observer, and its
      // failure is its own. Swallowing anything else would be wrong, but here the alternative is
      // that a broken UI kills the run it is watching.
      try {
        this.#sink?.(event);
      } catch {
        // Deliberately ignored — see above. The event is still in the array, so the batch path
        // (`AgentLoopOutput.events`) delivers it regardless.
      }
    }
    return length;
  }
}

/**
 * Build the loop's event log, seeded with the events that exist before the loop starts.
 *
 * `LiveEventLog.from` rather than `new LiveEventLog(...seed)`: the `Array` constructor treats a
 * single numeric argument as a length, and a seed is a list of events, never a count.
 */
export function createEventLog(seed: readonly SDKMessage[]): LiveEventLog {
  const log = new LiveEventLog();
  log.push(...seed);
  return log;
}
