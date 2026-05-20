# AGENTS.md — Theo Pro Telegram Bot

This is the Theo Pro example bot — a Telegram-native AI assistant
demonstrating the `@usetheo/sdk` end-to-end. The bot showcases
streaming, structured output, batch processing, memory adapters,
credential pools, and context-file discovery.

## What this bot does

- Listens on Telegram via grammY.
- Routes user messages through `Agent.send()` with the
  `@usetheo/sdk` agent loop.
- Persists session history per user.
- Demonstrates SDK features via slash commands (`/fact`, `/factstream`,
  `/batch`, `/memory`, `/goal`, `/pool`, `/context`).

## Conventions for agents reading this file

- Reply in the user's language (PT-BR or EN).
- Keep replies under 4 paragraphs.
- For code questions, show the `@usetheo/sdk` API surface.
- Do NOT execute destructive shell commands without explicit user confirmation.
