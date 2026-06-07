# Changelog

Workspace-level changes for the `theokit-sdk` monorepo. Per-package changes live in each package's `CHANGELOG.md`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — CI tooling pins for arch-review-fixes plan (T0.4)

- **`madge@8.0.0`** + **`@ls-lint/ls-lint@2.3.1`** added as exact-pinned devDeps at workspace root (T0.4 of plan `arch-review-fixes-2026-06-06`). Rationale doc at `docs/audit/ci-tool-versions-2026-06-06.md`: CI-gate dependencies (cycle detection, filename-naming linter) pinned exactly rather than `^x.y.z` to avoid silent gate drift. **Package-name discipline:** the bare `ls-lint` package on npm is an unrelated legacy livescript-based tool — confirmed via deps-audit (`.claude/knowledge-base/audits/arch-review-fixes-2026-06-06-deps-audit-2026-06-06.md`); the scoped `@ls-lint/ls-lint` is the correct package. Zero CVE per npm audit at install time.

### Added — Tier 1 Gateway Expansion v1.5 (ADRs D389-D421)

Four new workspace packages bringing the gateway fleet from 6 → 10, closing OCDE + APAC consumer + decentralized federation gaps:

- **`@theokit/gateway-sms@0.1.0`** (D389-D396) — Twilio + Plivo + Vonage backends; HMAC signature enforcement at construction (EC-1 absorbed); E.164 normalization via libphonenumber-js (D391, EC-6 toll-free OK); 1600-char multipart with `(i/N)` prefix (D393, EC-7 grapheme-safe via Intl.Segmenter); webhook server with raw-body capture + per-backend route. 32/32 unit tests + example app + env-gated live smoke.
- **`@theokit/gateway-mattermost@0.1.0`** (D397-D404) — `@mattermost/client@^9` WebSocket gateway + Client4 REST; thread reply bidirectional via `root_id` ↔ `topicId` (D399); channel-type mapping D→dm, G/O/P→group (D402); EC-2 absorbed mention pipeline (`metadata.mentions` array priority + word-boundary regex fallback — `@theory_dept` does NOT match a bot called `theo`); PAT auth only in v0.1 (D401). 53/53 unit tests.
- **`@theokit/gateway-line@0.1.0`** (D405-D412) — webhook-only with HMAC-SHA256 signature (D408) using `crypto.timingSafeEqual`; Reply token first + Push API fallback with 1000-entry LRU cache (D407, 60s TTL, one-shot); EC-4 absorbed event-type filter (LINE delivers 9 event types — adapter drops non-message + non-text at the top); 5000-char grapheme-safe split (D411); mentionee array handling (D409); source-type mapping user→dm, group/room→group (D410). 55/55 unit tests.
- **`@theokit/gateway-matrix@0.1.0`** (D413-D421) — `matrix-js-sdk@^32` (lazy ~2MB peer-dep); DM detection via `memberCount === 2` heuristic (D416); EC-3 absorbed initial-sync flood guard (drops events older than 60s — 50-room bot would fire 500 LLM calls on boot otherwise); alias resolution with caching (D419); E2EE rooms refused with one-shot stderr warn (D418, Olm/Megolm deferred to v0.2); federation transparent via SDK (D420). 44/44 unit tests.

Common to all four:
- Workspace packages with peer-dep policy (D171 reused).
- Extend `BasePlatformAdapter` (D172).
- `MessageEvent` discriminated union extended in `@theokit/gateway@[Unreleased]` — `PlatformName` 6 → 10 entries.
- EC-5 absorbed: exhaustive switch test updated to cover the 10 cases — no compile break in consumers.
- Build CJS+ESM+DTS verde; publint clean; attw 4/4 (node10/node16-CJS/node16-ESM/bundler) all green.
- Example app per gateway with env-gated live smoke (`*_LIVE_SMOKE=1`) — sms-bot / mattermost-bot / line-bot / matrix-bot under `examples/`.

Plan: `.claude/knowledge-base/plans/gateway-tier-1-expansion-plan.md`.
Edge case review: `.claude/knowledge-base/reviews/gateway-tier-1-expansion-edge-cases-2026-05-28.md` (22 edges, 5 MUST FIX absorbed inline: EC-1 through EC-5).

Total new tests: 184 unit + 4 example typechecks. Workspace `pnpm typecheck` clean; 0 regressions in pre-existing packages.

### Added — `@theokit/acp@0.1.0` (ACP server adapter, ADRs D349-D360)
- New `@theokit/acp` workspace package exposing any `@theokit/sdk` `SDKAgent` as
  an Agent Client Protocol (ACP) server over stdio JSON-RPC, using the official
  `@agentclientprotocol/sdk@^0.22`. Zed, Cursor, Claude Desktop, and any
  ACP-compatible host can drive our SDK as a coding agent.
- 12 new ADRs (D349-D360). 6 edge case fixes absorbed (EC-1 dispose-on-shutdown,
  EC-2 permission-timeout, EC-3 CloudAgent fork rejection, EC-4 CJS/ESM
  interop, EC-5 cwd absolute resolve, EC-6 storage hint).
- `theokit acp` CLI subcommand + standalone `theokit-acp` bin shim.
- `agent.json` registry manifest at `packages/acp/registry/` for the ACP marketplace.
- 57 new tests across session-store, agent-resolver, lifecycle, prompt-extract,
  translator, permission-plugin, plus a programmatic stdio smoke (`serve-smoke.test.ts`)
  that drives the full protocol end-to-end.
- Concept page + cookbook recipe in `theo-opendocs/content/theokit-sdk/`.
- `examples/acp-server/` real-LLM example.

### Added
- Initial workspace structure: pnpm workspaces, Biome 2.4, Changesets, tsup 8, Vitest 3, TypeScript 5.8+, Node 22.12+ engines (initial scaffold).
- `@theokit/sdk` package skeleton at `packages/sdk/` (initial scaffold).
- `pi/packages/*` integrated as workspace children via `pnpm-workspace.yaml` (initial scaffold).
- `docs.md` locked as the canonical public API contract (initial scaffold).
- `docs/` folder with human-friendly documentation: getting-started, concepts, guides (cron, MCP, subagents, hooks, errors, resource management), reference, and development guide for contributors (initial scaffold).
- `PITCH.md` at workspace root: landing-page copy for `@theokit/sdk` using the TheoKit aspirational voice (explicit exception authorized 2026-05-15).
- README: `## Memory, context, and skills` section, consolidated `## Status` section, `Context` / `Memory` / `Skills` entries in the Core concepts table, and the "Most agent SDKs ship open; most agent runtimes don't" differentiator line in `## Why @theokit/sdk`.
- README HERO + intro rewritten in the TheoKit aspirational voice; `## What you'd ship` section and `## How it works` DEEP DIVE delimiter inserted before `## Installation`. Everything below the delimiter remains technical-direct.
- `CLAUDE.md`: `## Voice and Tone` section formalizes the adoption of the TheoKit aspirational voice for TheoKit-SDK public surfaces (README HERO/BODY, `PITCH.md`, future launch material). `docs.md`, the DEEP DIVE layer of the README, ADRs, and this file stay technical-direct.

### Changed
- License standardized to **Apache-2.0** (was MIT). Aligns all Theo open-core pillars under a single license — see root `CLAUDE.md` strategic review of 2026-05-14.
- `pi/` and `cookbook/` moved under `referencia/` as read-only reference material; `pnpm-workspace.yaml` and `biome.json` updated to exclude `referencia/**` from workspace and lint targets.
- Root `CLAUDE.md` (`/home/paulo/Projetos/usetheo/CLAUDE.md`) `## Voice and Tone — sub-project scoped` updated to recognize TheoKit-SDK as an adopter of the aspirational voice (strategic review 2026-05-15). TheoKit-SDK removed from the "technical-direct only" list.

### Fixed
- README link to the local agent runtime pointed at `./pi` (workspace path that no longer exists after the move under `referencia/`); now points at `./referencia/pi`.
