# D178 — Telegram-pro migration preserves 100% of slash commands; dogfood is the regression gate

**Date:** 2026-05-21
**Status:** Accepted

## Decision

The `examples/telegram-pro` migration to consume `@theokit/gateway-telegram` does NOT drop, rename, or behaviorally change any of its 30+ slash commands. The `/telegram-pro-dogfood` skill (42 commands, CDP-driven against real Gemini-via-OpenRouter) is the regression gate.

## Rationale

The dogfood suite is the only ratchet test in the monorepo covering memory, MCP, vision, voice, batch, goals, personality, and the full Hermes feature parity. Removing or renaming commands invalidates the suite — and the suite is the only thing standing between us and silent regressions.

## Consequences

- **Enables:** mechanical migration with low cognitive risk; the dogfood pass/fail count is the migration's correctness signal.
- **Constrains:** any **enhancement** to a command (e.g., new flag, behavior change) is out of scope for the gateway migration PR — must be a follow-up.
