/**
 * `DeliveryRouter` — outbound dispatch by platform (T3.1, ADR D175).
 *
 * The router holds a map of `platform → adapter` and forwards
 * `DeliveryRequest` to the right adapter's `sendMessage`. Composes
 * with `Cron` from `@theokit/sdk` for scheduled delivery — the
 * router is the "WHERE to send", Cron is the "WHEN to fire".
 *
 * @public
 */

import type { BasePlatformAdapter, SendResult } from "../adapter/base.js";
import type { PlatformName } from "../types/message-event.js";

/** Target for an outbound delivery. */
export interface DeliveryTarget {
  readonly platform: PlatformName;
  readonly channel: {
    readonly id: string;
    readonly type: "dm" | "group" | "thread";
    readonly topicId?: string;
  };
}

/** Full outbound request: target + content. */
export interface DeliveryRequest extends DeliveryTarget {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly replyTo?: string;
}

/**
 * Routes outbound requests to the correct adapter.
 *
 * **Contract:**
 * - `register` is last-writer-wins by platform.
 * - `send` with unknown platform returns `{ ok: false, code: "no_adapter" }`.
 * - `send` never throws on platform errors (delegates to adapter's SendResult).
 *
 * @public
 */
export class DeliveryRouter {
  private readonly adapters = new Map<PlatformName, BasePlatformAdapter>();

  register(adapter: BasePlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  async send(req: DeliveryRequest): Promise<SendResult> {
    const adapter = this.adapters.get(req.platform);
    if (adapter === undefined) {
      return {
        ok: false,
        error: { code: "no_adapter", message: `no adapter for platform "${req.platform}"` },
      };
    }
    return adapter.sendMessage({
      channel: req.channel,
      text: req.text,
      ...(req.format !== undefined ? { format: req.format } : {}),
      ...(req.replyTo !== undefined ? { replyTo: req.replyTo } : {}),
    });
  }
}
