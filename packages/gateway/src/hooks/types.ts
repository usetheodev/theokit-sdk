/**
 * Gateway hooks — own contract, not a `Plugin.kind` extension
 * (T4.1, ADRs D176, D177).
 *
 * Three fire points:
 *  - `pre_inbound`  — runs sequentially; first `{ block: true }` short-circuits.
 *  - `post_outbound` — fire-and-forget; errors logged.
 *  - `on_error`     — fire-and-forget; called when the handler throws.
 *
 * Signature mirrors the SDK's `pre_tool_call` veto (D101) so consumers
 * have a single mental model for "block or continue" hooks.
 *
 * @public
 */

import type { OutboundMessage, SendResult } from "../adapter/base.js";
import type { MessageEvent as GatewayMessageEvent } from "../types/message-event.js";

/** Closed enum of hook fire points. */
export type HookName = "pre_inbound" | "post_outbound" | "on_error";

/**
 * Decision returned by a `pre_inbound` hook.
 *
 * - `block: true` short-circuits the chain — handler does NOT run.
 * - `message` set → runner calls `ctx.reply(message)` BEFORE short-circuit (EC-D).
 * - `block: false` or `undefined` → continue.
 */
export interface HookDecision {
  readonly block?: boolean;
  readonly message?: string;
}

/** Context passed to `pre_inbound` hooks. */
export interface PreInboundContext {
  readonly event: GatewayMessageEvent;
}

/** Context passed to `post_outbound` hooks. */
export interface PostOutboundContext {
  readonly event: GatewayMessageEvent;
  readonly outbound: OutboundMessage;
  readonly result: SendResult;
}

/** Context passed to `on_error` hooks. */
export interface OnErrorContext {
  readonly event: GatewayMessageEvent;
  readonly error: Error;
}

/** A gateway hook: any of the three fire-point methods are optional. */
export interface GatewayHook {
  readonly name: string;
  // biome-ignore lint/suspicious/noConfusingVoidType: sync-or-async hook ergonomics — matches SDK pre_tool_call signature (D101).
  pre_inbound?(ctx: PreInboundContext): Promise<HookDecision | void> | HookDecision | void;
  post_outbound?(ctx: PostOutboundContext): Promise<void> | void;
  on_error?(ctx: OnErrorContext): Promise<void> | void;
}

/**
 * Runs registered hooks at the right fire points. Stateless — safe to
 * construct per-event if hooks need event-scoped storage.
 *
 * @public
 */
export class HookExecutor {
  constructor(private readonly hooks: ReadonlyArray<GatewayHook>) {}

  /**
   * Fire `pre_inbound` hooks sequentially. First `{ block: true }` short-circuits.
   * A hook throwing is treated as `{ block: true }` (logged via the runner).
   */
  async firePreInbound(ctx: PreInboundContext): Promise<HookDecision> {
    for (const h of this.hooks) {
      if (h.pre_inbound === undefined) continue;
      // biome-ignore lint/suspicious/noConfusingVoidType: hook may return void (no decision) or a HookDecision.
      let decision: HookDecision | void;
      try {
        decision = await h.pre_inbound(ctx);
      } catch (err) {
        return {
          block: true,
          message: `hook ${h.name} threw: ${(err as Error).message}`,
        };
      }
      if (decision !== undefined && decision.block === true) {
        return decision;
      }
    }
    return { block: false };
  }

  /** Fire all `post_outbound` hooks; errors logged via stderr. */
  async firePostOutbound(ctx: PostOutboundContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.post_outbound === undefined) continue;
      try {
        await h.post_outbound(ctx);
      } catch (err) {
        process.stderr.write(
          `[gateway] post_outbound hook "${h.name}" threw: ${(err as Error).message}\n`,
        );
      }
    }
  }

  /** Fire all `on_error` hooks; errors logged via stderr. */
  async fireOnError(ctx: OnErrorContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.on_error === undefined) continue;
      try {
        await h.on_error(ctx);
      } catch (err) {
        process.stderr.write(
          `[gateway] on_error hook "${h.name}" threw: ${(err as Error).message}\n`,
        );
      }
    }
  }
}
