---
slug: m2-resilience-gap-closure
milestone_id: M2
created_at: 2026-07-14
goal: Close the genuine gaps adversarial review found in the shipped M2 fixes (#60/#61/#63/#59).
---

# Plan — M2 resilience gap closure

Same pattern (fixes shipped, checkboxes `[ ]`). 3 adversarial agents found real residual gaps.
Fix genuine defects (TDD); document design/scope trade-offs the reviewers flagged as out-of-issue.

| # | Finding | Sev | Task |
|---|---|---|---|
| #60-a | `Retry-After` ignored on the single-key 429 retry (re-hits before the window) | MED | T1 (pass clamped retryAfterMs into retry-path backoff) |
| #60-b | `Retry-After` HTTP-date form dropped (numeric-seconds only) | LOW | T2 (parse HTTP-date in parseRetryAfter) |
| #61-a | Anthropic client has NO truncation guard — clean-early-close committed as `end_turn` (OpenAI has it) | MED | T3 (add stop-seen guard → stream_truncated) |
| #59-a | permanent wedge after reconnect exhaustion (`reconnectAttempts` never re-arms) | MED | T4 (bounded loop per cycle; drop the sticky counter) |
| #59-b | HTTP reconnect has no test | LOW | T5 (add HTTP-recover-after-failure test) |
| #63-a | invalid pagination cursors silently coerced (NaN→full list) | LOW | T6 (validate + typed reject) |
| #63-b | cross-process lock untested (no real 2nd process) | MED-evidence | T7 (spawn a real child, prove no interleave) |

Documented (NOT fixed — scope/trade-off): #61 truncated-flag/{raw}-passthrough (task-paraphrase beyond
issue scope); #63 offset-not-cursor pagination (agreed ADR D4); #63 no-fsync-per-append (durability trade-off).

## DoD
- [ ] T1 retry honors clamped Retry-After; T2 HTTP-date parsed.
- [ ] T3 Anthropic clean-early-close → typed stream_truncated.
- [ ] T4 no permanent wedge — a later request after exhaustion recovers; H3 exhausted still holds.
- [ ] T5 HTTP reconnect proven; T6 invalid pagination rejected; T7 cross-process lock proven with a real child.
- [ ] full suite + typecheck + biome green; ROADMAP M2 flipped; changesets.
