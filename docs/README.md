# `@usetheo/sdk` documentation

Official documentation for `@usetheo/sdk` — the TypeScript SDK for the Theo agent harness.

> **Public beta.** APIs may change before general availability. The canonical machine-readable contract lives at [`../docs.md`](../docs.md); this folder is the human-friendly version.

---

## Getting started

- [Installation](./getting-started/installation.md) — install the package, satisfy peer dependencies, verify the setup
- [Quickstart](./getting-started/quickstart.md) — your first local agent, streaming events
- [Authentication](./getting-started/authentication.md) — `THEOKIT_API_KEY`, user keys vs service accounts

## Core concepts

- [Agent and Run](./concepts/agent-and-run.md) — the two primitives the SDK is built on
- [Runtimes](./concepts/runtimes.md) — local vs cloud, how to pick, runtime detection rules
- [Stream events](./concepts/stream-events.md) — `SDKMessage`, `InteractionUpdate`, `ConversationTurn`

## Guides

- [Cron jobs](./guides/cron-jobs.md) — schedule agent runs with cron expressions
- [MCP servers](./guides/mcp-servers.md) — inline and file-based MCP configuration
- [Subagents](./guides/subagents.md) — named subagents the parent agent can spawn
- [Context manager](./guides/context-manager.md) — file-based project context and public snapshots
- [Memory](./guides/memory.md) — durable facts isolated by namespace, user, and scope
- [Skills](./guides/skills.md) — file-based capability packs loaded from `.theokit/skills`
- [Hooks](./guides/hooks.md) — file-based project policy boundaries
- [Error handling](./guides/error-handling.md) — `TheokitAgentError` hierarchy, retry strategy
- [Resource management](./guides/resource-management.md) — `await using`, `dispose()`, lifecycle

## Reference

- [API overview](./reference/README.md) — pointer to per-namespace details
- [Canonical contract (`docs.md`)](../docs.md) — full source-of-truth API spec

## For contributors (development guide)

- [Setup](./development/setup.md) — clone, nvm, pnpm, first build
- [Architecture](./development/architecture.md) — monorepo layout, layering, build pipeline
- [Conventions](./development/conventions.md) — naming, tone, TDD, error class style
- [Testing](./development/testing.md) — Vitest patterns, smoke vs full coverage
- [Releasing](./development/releasing.md) — Changesets workflow, publish flow

---

## Where this fits

`@usetheo/sdk` is the **Harness** pillar of the [usetheo stack](../../README.md). The full stack:

| Pillar | Project | What it does |
| --- | --- | --- |
| UI | `@usetheo/ui` | Component primitives for AI surfaces |
| **Harness** | **`@usetheo/sdk`** | Agent runtime, local or cloud |
| Skills | `theokit` | Full-stack TypeScript framework |
| Runtime | Theo PaaS | Managed deploy target *(pre-release)* |

## License

MIT — see [`LICENSE`](../LICENSE).
