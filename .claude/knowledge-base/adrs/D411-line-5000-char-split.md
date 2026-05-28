# D411 — LINE 5000-char surrogate-safe multipart split

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`splitForLine(text, limit=5000)` segments into ≤5000-char chunks via `Intl.Segmenter` (grapheme cluster granularity).

## Rationale

LINE limit is 5000 chars per text message. Same surrogate-safe pattern as D272 (Slack 4000), D393 (SMS 1600).

## Consequences

Each chunk is one billable Push API call after free tier.
