/**
 * `SessionRouter` — pure routing logic: `MessageEvent → agentId`
 * (T2.1, ADR D174).
 *
 * The SDK already owns session persistence (`Agent.resume` + `agent-registry`).
 * The router's job is to produce a stable, deterministic key — the SDK then
 * hydrates the actual session.
 *
 * Default strategy format: `<platform>-<channelType>-<...key parts>`.
 *
 * **EC-B:** thread events without a `topicId` (adapter bug or non-thread
 * forum message) fall back to the group key — prevents `...-undefined`
 * split-brain sessions.
 *
 * @public
 */

import type { MessageEvent as GatewayMessageEvent } from "../types/message-event.js";

/** Strategy function: pure mapping from event to agentId string. */
export type AgentIdStrategy = (event: GatewayMessageEvent) => string;

/**
 * Default strategy. Sanitizes `-` to `_` inside ids so the format
 * remains parseable by `-` segments.
 */
export function defaultStrategy(event: GatewayMessageEvent): string {
  const { platform, channel, sender } = event;
  const sid = sanitize(sender.id);
  const cid = sanitize(channel.id);

  switch (channel.type) {
    case "dm":
      return `${platform}-dm-${sid}`;
    case "thread":
      // EC-B: missing topicId = adapter bug. Fall back to group key
      // to keep "key absent === group session" deterministic.
      if (channel.topicId === undefined) {
        return `${platform}-grp-${cid}-${sid}`;
      }
      return `${platform}-tpc-${cid}-${sanitize(channel.topicId)}`;
    case "group":
      return `${platform}-grp-${cid}-${sid}`;
  }
}

function sanitize(s: string): string {
  return s.replace(/-/g, "_");
}

/**
 * Routes inbound events to agent ids. Defaults to `defaultStrategy`;
 * callers override per-bot to preserve legacy keys (telegram-pro keeps
 * the `tg-pro-` prefix; new bots use the default `telegram-` prefix).
 *
 * @public
 */
export class SessionRouter {
  constructor(private readonly strategy: AgentIdStrategy = defaultStrategy) {}

  resolveAgentId(event: GatewayMessageEvent): string {
    return this.strategy(event);
  }
}
