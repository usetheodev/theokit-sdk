# D272 — Message split at 4000 chars (with surrogate-pair guard for emoji)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`splitForSlack(text)` breaks into ≤4000-char chunks. Break preference: `\n\n` → `\n` → ` `. UTF-16 surrogate-pair check before cut (EC-4) — if the cut position lands in the middle of a surrogate pair, backs up one position.

## Rationale

Slack `chat.postMessage.text` accepts up to 40k chars but shows truncated UI past ~4000 with "Show more". 4000 is the pragmatic limit for good UX. Surrogate guard prevents broken emoji at chunk boundaries.

## Consequences

- Long responses sent as multi-chunk preserving thread continuity.
- Emoji-heavy responses stay clean.
- Tests cover paragraph break + word break + surrogate edge.
