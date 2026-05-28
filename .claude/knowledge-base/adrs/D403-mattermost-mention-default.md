# D403 — Mattermost requireMention defaults to true (with EC-2 safe pipeline)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`requireMention: true` default for non-DM channels. Filter pipeline:

1. Loop guard (own posts).
2. DM → respond.
3. `requireMention === false` → respond.
4. **`metadata.mentions` array priority** (unambiguous user-id list).
5. **Word-boundary text regex** `\b@${botUsername}\b` (fallback).
6. Else → ignore.

## Rationale

Same cost-explosion reason as D285 (Slack). **EC-2 absorbed**: substring match (`text.includes("@theo")`) catches `@theory_dept`. Prioritizing the mentions array avoids the ambiguity; word-boundary regex in fallback prevents false positives.

## Consequences

`@theory_dept` does NOT match a bot called `theo`. Caller can opt out with `requireMention: false`.
