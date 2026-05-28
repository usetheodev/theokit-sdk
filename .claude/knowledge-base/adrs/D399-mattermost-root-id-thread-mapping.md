# D399 — Mattermost `root_id` ↔ `topicId` thread mapping

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Inbound posts with `root_id !== ""` → `event.channel.type = "thread"` + `topicId = root_id`. Outbound sends with `type === "thread"` + `topicId: <root>` set `root_id` on the new post.

## Rationale

Mirrors Slack's `thread_ts` pattern (D271). Cross-platform consistency reduces caller surprise.

## Consequences

Thread reply round-trip works bidirectionally without caller branching.
