---
"@theokit/sdk-tools": minor
---

Add `createCurrentTimeTool` — a built-in `current_time` tool. Codex-faithful at the core (Codex's
`clock.curr_time` returns UTC as `YYYY-MM-DD HH:MM:SS UTC`); this keeps that as the default and adds an
optional IANA `timezone` (additive superset — omitted ⇒ UTC) plus an unambiguous `iso` instant. Returns
`{ ok, current_time, iso, timezone }` or `{ ok: false, error: 'invalid_timezone' }`. The clock is
injectable (`{ clock }`) so the tool is deterministic under test.
