# D36 — Second chat bot example = CLI-bot (not Discord, not Slack)

**Status:** Decided
**Date:** 2026-05-17

## Decision

The second chat bot example in the `examples/` tree is `cli-bot` — an
interactive terminal bot that reads stdin, streams responses to stdout,
and persists per-user state under `.theokit/agents/cli-bot-${user}/`.
It uses all four DX helpers (`createAgentFactory`, `Agent.getOrCreate`,
`defineTool`, optionally `Agent.builder()`). Discord and Slack bots are
out of scope for v1.1.

## Rationale

The flagship Telegram bot proves DX in a real-world setup. A second
example proves portability of the same patterns to a different channel
shape. Three options were considered:

- **Discord bot**: requires a Discord application registered in the
  Discord developer portal, a bot token, and a server invite. Most
  open-source contributors won't bootstrap this just to run an example.
- **Slack bot**: similar friction; OAuth + workspace install.
- **CLI bot**: zero external infrastructure. `git clone && pnpm dev`
  opens a terminal prompt. Portable, reproducible in CI, and shows the
  same persistence + per-user threading pattern as Telegram in a
  different shape.

CLI also reveals failure modes Telegram doesn't expose — local
filesystem latency, stdin EOF handling, terminal interrupt (Ctrl+C)
cleanup — that are useful tests of the SDK's edge handling.

## Consequences

- N=2 chat bot examples in the repo (telegram-pro + cli-bot). The "DX
  portability" claim is provable, not vibe.
- The CLI bot is the recommended starting point for tutorial content —
  no signups, no tokens, copy/paste and chat.
- Discord and Slack bots are deferred to community contributions or a
  later release. Their absence is documented; consumers who need them
  can adapt the Telegram pattern.
- One more example to maintain (typecheck sweep, real-LLM sweep, etc).
  Acceptable cost given the validation value.
