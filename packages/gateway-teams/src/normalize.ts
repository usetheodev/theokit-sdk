/**
 * Normalize a `@microsoft/teams.api` `MessageActivity` into our portable
 * `TeamsMessageEvent` (ADR D318 + EC-3 + EC-4 + EC-9 absorbed).
 *
 * @internal
 */

import type { TeamsMessageEvent } from "@usetheo/gateway";

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __normalizeMarker: unique symbol = Symbol("normalize");

/**
 * EC-9 absorbed: regex tolerates HTML attributes inside `<at>` tags
 * (e.g. `<at type="user" mri="...">Bot</at>`).
 *
 * Note: the SDK already strips mentions when `activity.mentions.stripText: true`
 * is set on `AppOptions`. We keep this helper as a fallback / explicit cleanup
 * path for tests + callers who consume the raw text directly.
 */
export function stripTeamsMentions(
  text: string,
  botDisplayName?: string,
): string {
  // `<at ATTRS?>NAME</at>` — strip outer tags (with optional attributes), keep inner text.
  let cleaned = text.replace(/<at(?:\s+[^>]*)?>([^<]*)<\/at>/gi, "$1");
  if (botDisplayName !== undefined && botDisplayName.length > 0) {
    const escaped = botDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "g"), "");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

interface MessageActivityShape {
  type?: string;
  id?: string;
  text?: string;
  timestamp?: string;
  from?: {
    id?: string;
    name?: string;
    aadObjectId?: string;
  };
  conversation?: {
    id?: string;
    tenantId?: string;
    conversationType?: string;
    name?: string;
  };
  channelData?: {
    channel?: { id?: string };
    team?: { id?: string };
    teamsChannelId?: string;
    teamsTeamId?: string;
  };
}

function channelMapping(
  conv: MessageActivityShape["conversation"],
  channelData: MessageActivityShape["channelData"],
): { type: "dm" | "group"; topicId?: string } {
  const convType = conv?.conversationType;
  // EC-3: unknown / undefined conversationType defaults to "dm" with warn.
  switch (convType) {
    case "personal":
      return { type: "dm" };
    case "groupChat":
      return { type: "group" };
    case "channel": {
      const topicId =
        channelData?.channel?.id ?? channelData?.teamsChannelId;
      return topicId !== undefined ? { type: "group", topicId } : { type: "group" };
    }
    default:
      // EC-3: don't crash on system / typing / conversationUpdate activities.
      if (convType !== undefined) {
        console.warn(`[teams] unknown conversationType: ${convType} — defaulting to dm`);
      }
      return { type: "dm" };
  }
}

export function normalizeTeamsActivity(
  activity: unknown,
  botDisplayName?: string,
): TeamsMessageEvent {
  const act = (activity ?? {}) as MessageActivityShape;
  const convId = act.conversation?.id ?? "unknown";
  const mapping = channelMapping(act.conversation, act.channelData);
  // EC-4: sender fallback chain.
  const senderId = act.from?.id ?? act.from?.aadObjectId ?? "anonymous";
  const text = stripTeamsMentions(act.text ?? "", botDisplayName);
  const receivedAt = (() => {
    if (typeof act.timestamp !== "string") return Date.now();
    const t = Date.parse(act.timestamp);
    return Number.isFinite(t) ? t : Date.now();
  })();

  const channel: TeamsMessageEvent["channel"] =
    mapping.topicId !== undefined
      ? { id: convId, type: mapping.type, topicId: mapping.topicId }
      : { id: convId, type: mapping.type };

  const teams: TeamsMessageEvent["teams"] = {
    activityId: act.id ?? "unknown",
    conversationId: convId,
    conversationType: act.conversation?.conversationType ?? "personal",
    tenantId: act.conversation?.tenantId,
    channelId: act.channelData?.channel?.id ?? act.channelData?.teamsChannelId,
    teamId: act.channelData?.team?.id ?? act.channelData?.teamsTeamId,
    raw: activity,
  };

  return {
    id: act.id ?? "unknown",
    platform: "teams",
    sender: {
      id: senderId,
      displayName: act.from?.name,
    },
    channel,
    text,
    receivedAt,
    teams,
  };
}
