/**
 * Inbound normalization: LINE webhook event → LineMessageEvent.
 *
 * EC-4 absorbed: LINE webhook delivers 9 event types. Only `message`
 * events of `text` type are dispatched in v0.1; other types (`follow`,
 * `unfollow`, `postback`, image/audio/sticker messages, etc.) return
 * `undefined` so `adapter.dispatchEvent` skips them silently.
 *
 * D410: source.type mapping `user` → `dm`; `group`/`room` → `group`.
 */

import type { LineMessageEvent } from "@theokit/gateway";

import type { LineWebhookEvent } from "./types.js";

export function mapSourceType(sourceType: string): "dm" | "group" | "thread" {
  if (sourceType === "user") return "dm";
  return "group";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: EC-4 event-type filter + source-shape narrowing + mentionee extraction are intentionally co-located so the dispatch contract stays linear.
export function lineEventToMessageEvent(event: LineWebhookEvent): LineMessageEvent | undefined {
  // EC-4: filter at the top — non-message events have undefined fields downstream.
  if (event.type !== "message") return undefined;
  if (event.message === undefined) return undefined;
  if (event.message.type !== "text") return undefined;

  const source = event.source;
  if (source === undefined) return undefined;

  const sourceId = source.userId ?? source.groupId ?? source.roomId;
  const sourceType = source.type as "user" | "group" | "room";
  if (sourceId === undefined || sourceId.length === 0) return undefined;

  const channelId = source.groupId ?? source.roomId ?? source.userId ?? sourceId;
  const channelType = mapSourceType(sourceType);

  const mentionees: string[] = [];
  for (const m of event.message.mentionees ?? []) {
    if (m.userId !== undefined && m.userId.length > 0) mentionees.push(m.userId);
  }

  return {
    id: event.message.id ?? `line-${event.timestamp ?? Date.now()}`,
    platform: "line",
    sender: source.userId !== undefined ? { id: source.userId } : { id: sourceId },
    channel: { id: channelId, type: channelType },
    text: event.message.text ?? "",
    receivedAt: event.timestamp ?? Date.now(),
    line: {
      sourceType,
      sourceId,
      messageId: event.message.id ?? "",
      mentionees,
      ...(event.replyToken !== undefined ? { replyToken: event.replyToken } : {}),
      raw: event,
    },
  };
}
