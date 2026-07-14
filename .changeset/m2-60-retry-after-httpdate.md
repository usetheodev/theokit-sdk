---
"@theokit/sdk": patch
---

Fix (#60) — `Retry-After` now also parses the RFC-7231 HTTP-date form (`Retry-After: Wed, 21 Oct 2025 07:28:00 GMT`), converting it to seconds-until-then (clamped at 0 for a past date). Previously only the numeric-seconds form was honored; a date-form header was silently dropped. Clarified that the same-key 429 retry deliberately does not block on `Retry-After` (a multi-key pool rotates to a fresh key immediately; the cooldown is honored at pool-selection level).
