# `@theokit/sdk` documentation

Official documentation for `@theokit/sdk` — the TypeScript SDK for the Theo agent harness.

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

- [Workflows](./guides/workflows.md) — typed resumable pipelines (`.then`, `.stream()`, state, suspend/resume, compose)
- [Subscriptions](./guides/subscriptions.md) — server-pushed typed streams with resume tokens
- [Cron jobs](./guides/cron-jobs.md) — schedule agent runs (or a workflow) with cron expressions
- [MCP servers](./guides/mcp-servers.md) — inline and file-based MCP configuration
- [Subagents](./guides/subagents.md) — named subagents + programmatic delegation (hooks, messageFilter)
- [Context manager](./guides/context-manager.md) — file-based project context and public snapshots
- [Memory](./guides/memory.md) — durable facts isolated by namespace, user, and scope
- [Skills](./guides/skills.md) — file-based capability packs loaded from `.theokit/skills`
- [Hooks](./guides/hooks.md) — file-based project policy boundaries
- [Error handling](./guides/error-handling.md) — `TheokitAgentError` hierarchy, retry strategy
- [Resource management](./guides/resource-management.md) — `await using`, `dispose()`, lifecycle

## Reference

- [Canonical contract (`docs.md`)](../docs.md) — full source-of-truth API spec for every public subpath
- [API overview](./reference/README.md) — pointer to per-namespace details
- [Capability map](./harness-capability-map.md) — every public primitive + its import path, at a glance
- [Error codes](./error-codes.md) — the canonical `AgentRunError.code` reference
- [Stream events](./reference/stream-events.md) — the stream-event / `RunEvent` union

## Recipes

- [Recipes overview](./recipes/README.md) — copy-paste production patterns
- [Postgres conversation storage](./recipes/conversation-storage-postgres.md)
- [Redis conversation storage](./recipes/conversation-storage-redis.md)

## Migration

- [1.x → 2.0](./migration/1-x-to-2-0.md) — the package-split migration
- [1.6 → 1.7 subscriptions](./migration/1.6-to-1.7-subscriptions.md) — the streaming-subscriptions migration

## For contributors (development guide)

Start with the root [`CONTRIBUTING.md`](../CONTRIBUTING.md) (branch model, PR checklist, commit rules), then:

- [Setup](./development/setup.md) — clone, nvm, pnpm, first build
- [Architecture](./development/architecture.md) — monorepo layout, layering, build pipeline
- [Conventions](./development/conventions.md) — naming, tone, TDD, error class style
- [Testing](./development/testing.md) — Vitest patterns, smoke vs full coverage
- [Quality gates](./development/quality-gates.md) — G1–G11 hard gates + git hooks
- [Releasing](./development/releasing.md) — Changesets workflow, publish flow

---

## Where this fits

`@theokit/sdk` is the **Harness** pillar of the [Theo stack](../README.md). The full stack:

| Pillar | Project | What it does |
| --- | --- | --- |
| UI | `@theokit/ui` | AI-native primitives for agent surfaces (coding-agent + chat) |
| **Harness** | **`@theokit/sdk`** | Agent runtime, local or cloud |
| Skills | `theokit` | Full-stack TypeScript framework |
| Runtime | Theo PaaS | Managed deploy target *(pre-release)* |

## License

MIT — see [`LICENSE`](../LICENSE).
