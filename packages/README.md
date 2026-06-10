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
| `@theokit/sdk-memory` | **0.1.0** ✓ + iter 33-37 feature surface | `MemoryProvider` port consumer. `createInMemoryMarkdownProvider` with disk-backed session-summary write/recall + LLM-facing `memory_remember` + `memory_search` tools + agent-scope privacy filter. Phase 1 functional ship (iter 18 T1.6); rich impl source-move scheduled Stage 3 (iter 30 target). |
| `@theokit/sdk-budget` | **0.1.0** ✓ + Phase 2 physical Stage 1 (iter 19) | `BudgetTracker` port consumer + USD pricing tracker. Phase 2 physical Stage 1 moved 568 LOC of internal/budget primitives (registry / enforcement / ledger / normalize-usage / calendar-window) from sdk-core. sdk-core retains v1.x sync API copies for back-compat. |
| `@theokit/sdk-handoff` | **0.1.0** ✓ | Inter-agent dispatch via plugin protocol. `Handoff.asPlugin()` + lazy-loaded `internal/tool-injector`. Extracted Phase 4 (iter 6). attw clean across all 4 resolvers (iter 38 typesVersions fix). |
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
| `@theokit/codemod-sdk-2-0` | jscodeshift codemod for `@theokit/sdk` 1.x → 2.0 import rewriting. |

## SDK 2.0 split status

See `.claude/knowledge-base/plans/sdk-2-0-progress.md` for the running progress log.

| Phase | Task | Status |
|---|---|---|
| 0 | Baseline subsystem map + bundle snapshot | ✅ DONE |
| 1 | Extract `@theokit/sdk-memory` (functional + cohort + Stage 2b kernel flip) | 🟢 functional shipped; Stage 3 source-move pending (iter 30 target) |
| 2 | Extract `@theokit/sdk-budget` (functional + Stage 1 physical 568 LOC) | 🟢 functional + Stage 1 physical shipped (iter 18-19) |
| 3 | Extract `@theokit/sdk-cache` | ✅ DONE |
| 4 | Extract `@theokit/sdk-handoff` | ✅ DONE (iter 6 + typesVersions fix iter 38) |
| 5 | Extract `@theokit/sdk-tools` | ✅ DONE |
| 6 | Rename `@theokit/sdk` → `@theokit/sdk-core@2.0.0` | ⏳ pending (gated on bundle target after Stage 3) |
| 7 | Cohort bump 21 dependent packages | ⏳ pending (operator step; engineering blockers cleared iter 38) |
| 8 | Codemod jscodeshift | ✅ DONE (iter 39 added Memory + Budget map entries) |
| 9 | Documentation (this file) | ✅ in progress |
| 10 | CI bundle budget gate | ✅ DONE |

For granular state see:
- `.claude/knowledge-base/plans/sdk-2-0-phase-1-2-adr.md` — architectural decisions
- `.claude/knowledge-base/plans/sdk-2-0-phase-1-physical-progress.md` — iter-by-iter Stage 1/2 log
- `.claude/knowledge-base/plans/sdk-2-0-phase-1-stage-3-source-move-plan.md` — file-by-file Stage 3 plan
- `.claude/knowledge-base/plans/sdk-2-0-cohort-readiness-audit.md` — Phase 7 publish-readiness audit

## License

Apache-2.0.
