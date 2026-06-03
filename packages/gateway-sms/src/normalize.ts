/**
 * Inbound normalization: `SMSInbound` → `SMSMessageEvent`.
 *
 * `from` and `to` are already E.164 (backend.parseInbound enforces this).
 * `channel.id` is `from` because SMS conversations are flat per-pair
 * (D394 — no threading).
 *
 * @internal
 */

import type { SMSMessageEvent } from "@theokit/gateway";

import type { SMSInbound } from "./backend-types.js";

export function inboundToMessageEvent(
  inbound: SMSInbound,
  backend: "twilio" | "plivo" | "vonage",
): SMSMessageEvent {
  return {
    id: inbound.messageId,
    platform: "sms",
    sender: { id: inbound.from },
    channel: { id: inbound.from, type: "dm" },
    text: inbound.body,
    receivedAt: inbound.receivedAt,
    sms: {
      backend,
      messageId: inbound.messageId,
      from: inbound.from,
      to: inbound.to,
      raw: inbound.raw,
    },
  };
}
