/**
 * Normalize a Slack `message` event (Bolt body) into the canonical
 * `SlackMessageEvent` (ADRs D270, D271, D274, D275, D285).
 *
 * Returns `undefined` for:
 *   - Non-message event types.
 *   - Bot-self messages (D275 loop guard).
 *   - Subtype `bot_message`.
 *   - Edited / channel_join / channel_leave / other non-user subtypes
 *     (only `"thread_broadcast"` is kept among subtypes).
 *   - EC-3 / D285: public-channel messages without an `@bot` mention,
 *     unless `requireMention === false`.
 *
 * @internal
 */

import type { SlackMessageEvent } from "@usetheo/gateway";

export interface BoltMessageBody {
  event: {
    type: "message" | string;
    channel: string;
    channel_type?: "im" | "mpim" | "channel" | "group";
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
  team_id?: string;
}

export interface NormalizeOptions {
  /** D285: when `true` (default), public-channel messages without `@bot` are dropped. */
  readonly requireMention?: boolean;
}

export function normalizeSlackEvent(
  body: BoltMessageBody,
  botUserId: string | undefined,
  opts: NormalizeOptions = {},
): SlackMessageEvent | undefined {
  const e = body.event;
  if (e.type !== "message") return undefined;
  // D275 bot loop guard
  if (e.user !== undefined && botUserId !== undefined && e.user === botUserId) return undefined;
  if (e.bot_id !== undefined && e.subtype === "bot_message") return undefined;
  // Skip subtypes that aren't user messages — but keep "thread_broadcast"
  // (a reply explicitly broadcast to the parent channel).
  if (e.subtype !== undefined && e.subtype !== "thread_broadcast") return undefined;

  // D270 channel type
  let channelType: "dm" | "group" | "thread";
  if (e.thread_ts !== undefined && e.thread_ts !== e.ts) {
    channelType = "thread";
  } else if (e.channel_type === "im") {
    channelType = "dm";
  } else {
    channelType = "group";
  }

  // EC-3 / D285: mention guard for public channels (default required).
  const requireMention = opts.requireMention ?? true;
  if (
    requireMention &&
    channelType === "group" &&
    e.channel_type === "channel" &&
    botUserId !== undefined &&
    !(e.text ?? "").includes(`<@${botUserId}>`)
  ) {
    return undefined;
  }

  const userId = e.user ?? "anonymous";
  const event: SlackMessageEvent = {
    id: `slack-${body.team_id ?? "?"}-${e.channel}-${e.ts}`,
    platform: "slack",
    sender: { id: userId },
    channel: {
      id: e.channel,
      type: channelType,
      ...(channelType === "thread" && e.thread_ts !== undefined ? { topicId: e.thread_ts } : {}),
    },
    text: e.text ?? "",
    receivedAt: Math.floor(Number(e.ts) * 1000),
    slack: {
      teamId: body.team_id,
      channelId: e.channel,
      userId,
      ts: e.ts,
      ...(e.thread_ts !== undefined ? { threadTs: e.thread_ts } : {}),
      ...(e.subtype !== undefined ? { subtype: e.subtype } : {}),
      raw: body,
    },
  };
  return event;
}
