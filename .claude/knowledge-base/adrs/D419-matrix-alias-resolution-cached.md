# D419 — Matrix alias → room id resolution + caching

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`channel.id` accepts:
- `!abc:server` (room id) — pass-through.
- `#general:server` (alias) — resolved via `client.getRoomIdForAlias`, then cached.

Other shapes throw `ConfigurationError({ code: "invalid_room_ref" })`.

## Rationale

Humans use aliases (Element displays alias). Internally Matrix operates on stable IDs. Resolve on first use + cache to avoid repeated network calls.

## Consequences

If admin renames alias mid-process, cached send fails. Documented; restart resolves.
