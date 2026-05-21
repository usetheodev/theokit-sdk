# D165 — Telegram-pro slash command is `/personality`

**Date:** 2026-05-20
**Status:** Accepted

## Decision

The reference bot (`examples/telegram-pro`) exposes personality
switching via the slash command `/personality <name>`. Bare
`/personality` lists available presets. `/personality none` (and
`default` / `neutral`) clears the active preset.

## Rationale

`/personality` is the most direct name for the operation, matches the
ADR family's vocabulary, and avoids the conflict-prone `/persona` (which
collides with the Hermes "persona" feature category). It mirrors the
public SDK method `agent.usePersonality(...)` — same word, same intent,
in the demo surface.

## Consequences

- **Enables:** users discover the feature via `/help` listing
  `/personality`.
- **Constrains:** if telegram-pro later adds runtime persona-blending
  (separate concept), it must use a different command name.
