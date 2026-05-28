# D393 — SMS multipart split at 1600 chars with `(i/N)` prefix

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Outbound text > 1600 chars segmented into N parts, each prefixed `(i/N)`. UTF-16 surrogate-safe split via `Intl.Segmenter` (grapheme granularity).

## Rationale

160 is GSM-7 single-segment limit; concatenated SMS (UDH) at modern carriers reassemble up to 1600 chars cleanly. **EC-7 absorbed:** prefix `(i/N)` allows manual reordering when carriers deliver out of sequence.

## Consequences

Each part is one billable message at the carrier. Caller should plan accordingly.
