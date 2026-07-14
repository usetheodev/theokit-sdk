---
slug: theokit-rules-path-scoped
date: 2026-07-13
verdict: SHIPPABLE
---

# Blueprint — `.theokit/rules/*.md` path-scoped rules spec

## Goal

Add a theokit-native `.theokit/rules/*.md` discovery spec whose frontmatter accepts
`paths:` (Claude Code parity) / `globs:` (Cursor alias), mirroring `.claude/rules/`.
Path-scoped rules MUST genuinely activate at send-time (no silent no-op).

## Coverage Corner 1 — Integration Tests

Peer test precedents (cited, real in clones):
- codex `codex-rs/hooks/src/config_rules.rs:72-239` — layer-precedence + malformed-entry merge tests.
- mastra `docs/scripts/validate-frontmatter.ts:95-121` — frontmatter parse + skip-path logic.
- mastra `packages/editor/src/rule-evaluator.test.ts` — rule EVALUATION (AND/OR), not discovery.

SDK test surface to mirror (real):
- `packages/sdk/tests/internal/runtime/context-discovery.test.ts` — mkdtemp + `.git` + file tree + assert discovery count/order/realpath-dedup.
- `context-frontmatter.test.ts`, `context-loaders.test.ts`, `context-backward-compat.test.ts`.
- `packages/sdk/tests/contract/context-manager.contract.test.ts` — agent + `local.settingSources:["project"]` + `agent.context.snapshot()` assertions.
- `packages/sdk/tests/golden/context/*`, `tests/fixtures/repos/project-with-context/*` — fixture repo convention.

## Coverage Corner 2 — Dependencies

- **NO new dependency.** Parsimony Rung 4: SDK already ships `globToRegex` (`context-mdc-parser.ts`) and `yaml-frontmatter.ts` + Zod. tinyglobby (mastra `package.json:116`) / minimatch / micromatch are all REJECTED as redundant.

## Coverage Corner 3 — Tools (integration points, cited file:line)

- Spec registry: `context-discovery.ts:55-104` (`DEFAULT_DISCOVERY_SPECS`), parser union at `:27`.
- Parser precedent: `context-mdc-parser.ts` — `parseMdc()` `:49-65`, `McdFrontmatterSchema` `:24-28`, `shouldActivate()` `:74-80`, `globToRegex()`.
- Dispatch: `context-discovery-runner.ts` `loadOneSource()` `:85-110`, `loadMdcSource()` `:112-134`, `DiscoveryRunnerOptions.touchedFiles` `:39`.
- Gate: `context-manager.ts` `initialize()` `:61-68`, `refresh()` `:71-108` (calls `runDiscovery` `:82` WITHOUT touchedFiles → the v1 gap).
- Aggregator (no change needed): `context-aggregator.ts:39-74`.
- Prompt injection (no change): `system-prompt/sources/context-provider.ts:19-31`.
- Config surface: `types/agent.ts` (context, local.settingSources), `types/context.ts` `ContextSettings:16-39`.

## Coverage Corner 4 — Techniques

- Glob-gated activation (Cursor `.mdc`) — the canonical target; reuse SDK `globToRegex`.
- Priority-merge concat (SDK aggregator already does this deterministically).
- Explicit scope signal: host declares in-scope files (Cursor knows the open file; an SDK host passes it). This is the honest activation contract.

## ADRs

- **ADR-1 — No new glob dependency.** Reuse `globToRegex`. Alt: tinyglobby/minimatch (redundant). Chosen: reuse (Rung 4).
- **ADR-2 — `paths:` primary + `globs:` alias.** Both are glob-pattern arrays. Mirrors `.claude/rules/` (`paths:`) while staying Cursor-compatible (`globs:`). Alt: globs-only (rejected — user wants Claude-Code `paths:` branding).
- **ADR-3 — Activation via explicit `contextPaths` send-option (+ `alwaysApply`).** `touchedFiles` is empty at send-time; a real signal is required or path-scoped rules are a silent no-op (violates no-stubs). The host declares in-scope files via `agent.send(msg, { contextPaths })`. Alt rejected: infer from message text (fragile heuristic); hook file-read tools (rules assemble before tools run). NOT a workaround — it is the first-class scope contract; same plumbing also unblocks `.cursor/rules` globs.
- **ADR-4 — New parser `rules-frontmatter`, sibling to mdc.** Do not modify the mdc parser (OCP/LSP — keep `.cursor/rules` behavior intact). Reuse yaml-frontmatter + Zod + globToRegex.
- **ADR-5 — Spec priority 45** (between cursor-rules 40 and theokit-context 50).
