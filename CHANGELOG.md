# Changelog

Workspace-level changes for the `theokit-sdk` monorepo. Per-package changes live in each package's `CHANGELOG.md`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — `@usetheo/acp@0.1.0` (ACP server adapter, ADRs D349-D360)
- New `@usetheo/acp` workspace package exposing any `@usetheo/sdk` `SDKAgent` as
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
- `@usetheo/sdk` package skeleton at `packages/sdk/` (initial scaffold).
- `pi/packages/*` integrated as workspace children via `pnpm-workspace.yaml` (initial scaffold).
- `docs.md` locked as the canonical public API contract (initial scaffold).
- `docs/` folder with human-friendly documentation: getting-started, concepts, guides (cron, MCP, subagents, hooks, errors, resource management), reference, and development guide for contributors (initial scaffold).
- `PITCH.md` at workspace root: landing-page copy for `@usetheo/sdk` using the TheoKit aspirational voice (explicit exception authorized 2026-05-15).
- README: `## Memory, context, and skills` section, consolidated `## Status` section, `Context` / `Memory` / `Skills` entries in the Core concepts table, and the "Most agent SDKs ship open; most agent runtimes don't" differentiator line in `## Why @usetheo/sdk`.
- README HERO + intro rewritten in the TheoKit aspirational voice; `## What you'd ship` section and `## How it works` DEEP DIVE delimiter inserted before `## Installation`. Everything below the delimiter remains technical-direct.
- `CLAUDE.md`: `## Voice and Tone` section formalizes the adoption of the TheoKit aspirational voice for TheoKit-SDK public surfaces (README HERO/BODY, `PITCH.md`, future launch material). `docs.md`, the DEEP DIVE layer of the README, ADRs, and this file stay technical-direct.

### Changed
- License standardized to **Apache-2.0** (was MIT). Aligns all usetheo open-core pillars under a single license — see root `CLAUDE.md` strategic review of 2026-05-14.
- `pi/` and `cookbook/` moved under `referencia/` as read-only reference material; `pnpm-workspace.yaml` and `biome.json` updated to exclude `referencia/**` from workspace and lint targets.
- Root `CLAUDE.md` (`/home/paulo/Projetos/usetheo/CLAUDE.md`) `## Voice and Tone — sub-project scoped` updated to recognize TheoKit-SDK as an adopter of the aspirational voice (strategic review 2026-05-15). TheoKit-SDK removed from the "technical-direct only" list.

### Fixed
- README link to the local agent runtime pointed at `./pi` (workspace path that no longer exists after the move under `referencia/`); now points at `./referencia/pi`.
