/**
 * `defineSubscription` DSL (G8 public API) — `@theokit/sdk`.
 *
 * Per ADR D426 (AsyncGenerator handler + Zod input/output schemas).
 *
 * @public
 */

import type { SubscriptionCtx, SubscriptionDescriptor, TrackedEnvelope, ZodLike } from "./types.js";

/**
 * Options accepted by {@link defineSubscription}.
 *
 * @public
 */
export interface DefineSubscriptionOptions<TInput, TOutput> {
  /** Optional explicit name. Falls back to filename derivation by the scanner. */
  name?: string;
  /** Zod schema validating subscription input. Required (typed RPC contract). */
  input: ZodLike<TInput>;
  /** Zod schema describing each output frame. Informational; not enforced per-frame. */
  output: ZodLike<TOutput>;
  /**
   * Handler that produces the subscription stream.
   *
   * Receives the validated input + {@link SubscriptionCtx}. Yielding a value
   * emits a plain output frame. Yielding a `tracked(id, payload)` envelope
   * additionally advertises a resume token to the client so reconnects can
   * resume from that point.
   */
  handler: (
    input: TInput,
    ctx: SubscriptionCtx,
  ) => AsyncGenerator<TOutput | TrackedEnvelope<TOutput>, void, void>;
}

/**
 * Define a typed subscription. Pair with `Theokit.subscribe(name, input)`
 * on the client side.
 *
 * Per ADR D426 — handler is `AsyncGenerator<TOutput | TrackedEnvelope<TOutput>>`.
 * The runtime validates input via `opts.input.safeParse` BEFORE invoking the
 * handler; failure throws {@link import('./types.js').SubscriptionInputError}.
 *
 * @example
 * ```ts
 * import { Subscription } from "@theokit/sdk/subscription";
 * import { z } from "zod";
 *
 * export default Subscription.create({
 *   input: z.object({ topic: z.string() }),
 *   output: z.object({ message: z.string(), ts: z.number() }),
 *   async *handler(input, ctx) {
 *     let cursor = ctx.lastEventId ?? "0";
 *     while (!ctx.signal.aborted) {
 *       const msgs = await fetchMessagesSince(input.topic, cursor);
 *       for (const m of msgs) {
 *         cursor = m.id;
 *         yield ctx.tracked(m.id, { message: m.body, ts: m.ts });
 *       }
 *       await sleep(1000);
 *     }
 *   },
 * });
 * ```
 *
 * @public
 */
export function defineSubscription<TInput, TOutput>(
  opts: DefineSubscriptionOptions<TInput, TOutput>,
): SubscriptionDescriptor<TInput, TOutput> {
  if (opts === null || typeof opts !== "object") {
    throw new TypeError("defineSubscription: options object is required");
  }
  if (opts.input === undefined || typeof opts.input.safeParse !== "function") {
    throw new TypeError("defineSubscription: opts.input must be a Zod schema (or ZodLike)");
  }
  if (opts.output === undefined || typeof opts.output.safeParse !== "function") {
    throw new TypeError("defineSubscription: opts.output must be a Zod schema (or ZodLike)");
  }
  if (typeof opts.handler !== "function") {
    throw new TypeError("defineSubscription: opts.handler must be an async generator function");
  }
  return {
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    input: opts.input,
    output: opts.output,
    handler: opts.handler,
  };
}

/** SE36 — `Subscription.create` replaces `defineSubscription` (ADR 0015). @public  *
 * `Subscription.create` returns a **`SubscriptionDescriptor<TInput, TOutput>`**, not a
 * `Subscription`. The class is the namespace; the descriptor is the product.
 */
export class Subscription {
  private constructor() {}
  static create<TInput, TOutput>(
    opts: DefineSubscriptionOptions<TInput, TOutput>,
  ): SubscriptionDescriptor<TInput, TOutput> {
    return defineSubscription(opts);
  }
}
