# wiring-validator — m3-catastrophic-shell
Verdict (initial): 0 BLOCKER, 1 HIGH.
- catastrophicShellReason: pillar (a) PASS (createShellTool caller), (b) PASS (integration tests), (c) N/A consistent.
- HIGH → FIXED (3a18409): CatastrophicCommandError orphan export — zero production callers (only self-referential test); SsrfBlockedError thrown from 5 sites by contrast. knip blind to barrel orphans. Fixed by constructing it in the handler (err.code is single source of the error string).
- Barrel export correct; re-export test green.
