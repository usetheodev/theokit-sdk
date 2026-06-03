/**
 * Inbound normalization: Mattermost Post → MattermostMessageEvent.
 *
 * Channel-type mapping (D402):
 * - `D` (Direct) → `"dm"`
 * - `G`/`O`/`P` (Group/Open/Private) → `"group"`
 * - Posts with `root_id !== ""` → `"thread"` with `topicId = root_id` (D399).
 */

import type { MattermostMessageEvent } from "@theokit/gateway";

import type { MattermostChannel, MattermostPost } from "./types.js";

export function normalizeMattermostType(
  channel: MattermostChannel | undefined,
): "D" | "G" | "O" | "P" | (string & {}) {
  return channel?.type ?? "O";
}

export function mapChannelType(rawType: string, hasRootId: boolean): "dm" | "group" | "thread" {
  if (hasRootId) return "thread";
  if (rawType === "D") return "dm";
  return "group";
}

export function postToMessageEvent(
  post: MattermostPost,
  channel: MattermostChannel | undefined,
  senderUsername: string | undefined,
): MattermostMessageEvent {
  const rawType = normalizeMattermostType(channel);
  const channelType = mapChannelType(rawType, post.root_id.length > 0);
  return {
    id: post.id,
    platform: "mattermost",
    sender: {
      id: post.user_id,
      ...(senderUsername !== undefined ? { username: senderUsername } : {}),
    },
    channel: {
      id: post.channel_id,
      type: channelType,
      ...(channelType === "thread" ? { topicId: post.root_id } : {}),
    },
    text: post.message,
    receivedAt: post.create_at > 0 ? post.create_at : Date.now(),
    mattermost: {
      postId: post.id,
      channelId: post.channel_id,
      teamId: channel?.team_id ?? "",
      ...(post.root_id.length > 0 ? { rootId: post.root_id } : {}),
      channelType: rawType,
      raw: post,
    },
  };
}
