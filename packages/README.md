# `theokit-sdk` packages

This monorepo ships **24 packages** organized in **5 families**. The family lets you find a package by what it does, not by alphabetical position.

> **SDK 2.0 split in progress (Phase 9 / T9.1).** This table reflects the current state of the migration plan. See `docs/migration/1-x-to-2-0.md` for the consumer migration guide and `.claude/knowledge-base/plans/sdk-2-0-package-split-plan.md` for the full plan.

## Families

### Core — agent runtime + extensions + data layer

| Package | Status | Purpose |
|---|---|---|
| `@theokit/sdk` | **1.7.0 → 2.0.0** (pending rename to `@theokit/sdk-core`) | Agent kernel: `Agent`, `AgentBuilder`, `AgentFactory`, `defineTool`, runtime loop, plugin foundation, persistence primitives. |
| `@theokit/sdk-cache` | **0.1.0** ✓ | Semantic LLM response cache. Integrates via Plugin protocol. Extracted in Phase 3. |
| `@theokit/sdk-tools` | **0.1.0** ✓ | Built-in tools (read-file, list-dir, search-text, git-diff, subprocess, run-vitest). Extracted in Phase 5. |
| `@theokit/sdk-memory` | _pending Phase 1_ | Memory subsystem (embeddings, dreaming, storage adapters). Currently inside `@theokit/sdk`. |
| `@theokit/sdk-budget` | _pending Phase 2_ | Token/USD budget enforcement + pricing registry. Currently inside `@theokit/sdk`. |
| `@theokit/sdk-handoff` | _pending Phase 4_ | Inter-agent dispatch. Currently inside `@theokit/sdk`. |
| `@theokit/orm` | 0.1.0 | Lightweight ORM atop better-sqlite3. |
| `@theokit/di` | 0.1.0 | Dependency-injection container. |
| `@theokit/di-agent` | 0.1.0 | Decorator-driven Agent factory atop `@theokit/di`. |

### Channels — agent-to-channel adapters

| Package | Purpose |
|---|---|
| `@theokit/gateway` | Core abstractions for channel adapters. |
| `@theokit/gateway-telegram` | Telegram bot integration. |
| `@theokit/gateway-slack` | Slack bot integration. |
| `@theokit/gateway-whatsapp` | WhatsApp Cloud API integration. |
| `@theokit/gateway-teams` | Microsoft Teams integration. |
| `@theokit/gateway-email` | SMTP/IMAP email channel. |
| `@theokit/gateway-sms` | Twilio SMS channel. |
| `@theokit/gateway-mattermost` | Mattermost channel. |
| `@theokit/gateway-line` | LINE messaging API. |
| `@theokit/gateway-matrix` | Matrix protocol. |
| `@theokit/gateway-discord` | Discord bot integration. |

### Memory adapters — external memory backends

| Package | Purpose |
|---|---|
| `@theokit/memory-honcho` | Honcho.dev memory backend. |
| `@theokit/memory-mem0` | mem0.ai memory backend. |
| `@theokit/memory-supermemory` | supermemory.ai memory backend. |

### React — React-side hooks and components

| Package | Purpose |
|---|---|
| `@theokit/react` | React hooks bound to `@theokit/sdk` (`useAgent`, `useAgentRun`, etc.). |

### Integrations — protocol adapters + tooling

| Package | Purpose |
|---|---|
| `@theokit/acp` | Agent Client Protocol (ACP) server adapter. |
| `@theokit/skills-google-workspace` | Google Workspace skills (Gmail, Calendar, Drive). |
| `@theokit/cli` | `theokit` CLI binary (init, dev, inspect, eval, acp). |

## SDK 2.0 split status

See `.claude/knowledge-base/plans/sdk-2-0-progress.md` for the running progress log.

| Phase | Task | Status |
|---|---|---|
| 0 | Baseline subsystem map + bundle snapshot | ✅ DONE |
| 1 | Extract `@theokit/sdk-memory` | ⏳ pending |
| 2 | Extract `@theokit/sdk-budget` | ⏳ pending |
| 3 | Extract `@theokit/sdk-cache` | ✅ DONE |
| 4 | Extract `@theokit/sdk-handoff` | ⏳ pending |
| 5 | Extract `@theokit/sdk-tools` | ✅ DONE |
| 6 | Rename `@theokit/sdk` → `@theokit/sdk-core@2.0.0` | ⏳ pending |
| 7 | Cohort bump 21 dependent packages | ⏳ pending |
| 8 | Codemod jscodeshift | ✅ DONE |
| 9 | Documentation (this file) | ✅ in progress |
| 10 | CI bundle budget gate | ✅ DONE |

## License

Apache-2.0.
