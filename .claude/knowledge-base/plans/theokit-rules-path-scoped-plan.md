---
slug: theokit-rules-path-scoped
created_at: 2026-07-13
goal: Add a theokit-native `.theokit/rules/*.md` discovery spec whose frontmatter accepts paths:/globs: and whose path-scoped rules genuinely activate at send-time via an explicit contextPaths signal.
---

# Plan — `.theokit/rules/*.md` path-scoped rules

## Goal

Ship `.theokit/rules/*.md` (theokit-branded, mirroring `.claude/rules/`): a discovery
spec + a frontmatter parser accepting `paths:` (Claude Code) / `globs:` (Cursor alias) +
`alwaysApply`, where path-scoped rules **actually activate** at send-time (no silent
no-op) via a first-class `contextPaths` send-option. No new dependency.

## Coverage Matrix (every Goal claim → task)

| # | Goal claim | Task | Test |
|---|---|---|---|
| G1 | `.theokit/rules/*.md` is discovered | T2 (registry spec, prio 45) | discovery test finds it |
| G2 | frontmatter accepts `paths:`/`globs:`/`alwaysApply` | T1 (parser+schema) | parse unit tests |
| G3 | path-scoped rules activate for real | T3 (contextPaths→refresh→runDiscovery) | contract e2e: activates iff match |
| G4 | `alwaysApply:true` always loads | T1/T2 | activation unit + discovery test |
| G5 | no new dep; reuse `globToRegex` | T1 (extract/export shared glob) | grep no tinyglobby; unit reuses |
| G6 | `.cursor/rules` still works (regression) | T3 | backward-compat test green |
| G7 | evidence + docs + CHANGELOG | T4 | example runs; docs.md; changelog |

## Baseline Context (verified file:line)

- `context-discovery.ts:55-104` `DEFAULT_DISCOVERY_SPECS`; parser union `:27`; `isSafePattern` `:115`.
- `context-mdc-parser.ts`: `parseMdc` `:49`, `shouldActivate` `:74`, `globToRegex` `:82` (PRIVATE — extract), `parseSimpleYaml` `:102`.
- `context-discovery-runner.ts`: `DiscoveryRunnerOptions.touchedFiles` `:38`, `loadOneSource` dispatch `:85-110`, `loadMdcSource` `:112`.
- `context-manager.ts`: `refresh()` `:71` (calls `runDiscovery` `:82` WITHOUT touchedFiles — the gap), `internalAssemblySnapshot` `:133`; `SDKContextManager` in `types/context.ts`.
- `local-assembly.ts:117-121` reads `internalAssemblySnapshot()` per send; `inputs.options` present (`memory?.autoInject`).
- `local-agent.ts:440` `await this.context.refresh()` (no-arg reload — must stay compatible).
- `SendOptions` `types/run.ts:295`.

## Tasks (TDD-first)

### Phase 1 — Parser + activation logic (unit)
- **T1.1** New `context-rules-frontmatter.ts`: `RulesFrontmatterSchema` (`description?`, `paths?: string[]`, `globs?: string[]`, `alwaysApply?`, `enabled?`); `parseRules(content)` reusing `parseSimpleYaml`; `shouldActivateRule(fm, touchedFiles)`.
  - TDD RED: `parseRules` extracts paths+globs+alwaysApply; malformed → undefined; no-frontmatter → alwaysApply:true. `shouldActivateRule`: alwaysApply→true; empty touchedFiles + scoped→false; glob/paths match→true; `enabled:false`→never.
- **T1.2** Extract `globToRegex` to shared `context-glob.ts` (or export from mdc-parser); mdc-parser imports it (DRY, no behavior change).
  - TDD RED: shared `globToRegex` unit (`**`, `*`, `?`, brace? — keep parity with current; braces are a stretch, only if trivial).

### Phase 2 — Registry + runner dispatch (discovery integration)
- **T2.1** Add spec `theokit-rules` (`.theokit/rules/*.md`, globbed, parser `rules-frontmatter`, priority 45) to `DEFAULT_DISCOVERY_SPECS`; add `"rules-frontmatter"` to `DiscoveryParser`.
- **T2.2** `loadRulesSource` in runner + dispatch branch; threads `opts.touchedFiles`.
  - TDD RED (mirror `context-discovery.test.ts`): mkdtemp+.git; `.theokit/rules/always.md`(alwaysApply) present w/ empty touchedFiles; `.theokit/rules/api.md`(paths: src/api/**) absent w/ empty, present w/ touchedFiles=["src/api/x.ts"].

### Phase 3 — Send-time wiring (make it functional)
- **T3.1** `SendOptions.contextPaths?: readonly string[]` (`types/run.ts`) — host declares in-scope files.
- **T3.2** `FileContextManager.refresh(opts?: { touchedFiles?: readonly string[] })` → `runDiscovery({ ..., touchedFiles })`; update `SDKContextManager.refresh` signature (optional arg → back-compat). `local-agent.ts:440` no-arg call unaffected.
- **T3.3** `buildAssemblyContext`: when `inputs.options.contextPaths?.length` and `inputs.context`, `await inputs.context.refresh({ touchedFiles: inputs.options.contextPaths })` BEFORE `internalAssemblySnapshot()`. (Lazy: only pays FS cost when the feature is used.)
  - TDD RED (contract, fixture `repos/project-with-rules`): agent w/ `local.settingSources:["project"]`; `agent.send("...", { contextPaths:["src/api/x.ts"] })`; assert snapshot INCLUDES the api-scoped rule; a send WITHOUT contextPaths excludes it; alwaysApply always included.
- **T3.4** Regression: `.cursor/rules/*.mdc` with globs also activates when contextPaths matches (same plumbing) — backward-compat test.

### Phase 4 — Evidence + docs
- **T4.1** Example `examples/rules-path-scoped/` (deterministic: build agent, snapshot proves scoped rule activates only with matching contextPaths). Register in workspace + manifest.
- **T4.2** `docs.md` context-files section documents `.theokit/rules/*.md` + `contextPaths`. New docs site section `content/theokit/rules/` (Overview + how-to + advanced).
- **T4.3** CHANGELOG `[Unreleased]` + changeset (minor).

## Drawbacks & Risks

- **R1 — per-send refresh cost.** Refreshing on every send with contextPaths re-globs/re-reads FS. Mitigation: refresh only when `contextPaths` is provided (lazy); absent → create-time snapshot (alwaysApply only). Documented.
- **R2 — `paths` vs `globs` semantics.** Both are glob-pattern arrays matched against host-provided repo-relative paths. Documented; not exact-path.
- **R3 — v2 auto-touchedFiles.** Auto-deriving touched files from tool reads remains v2; v1 contract is explicit `contextPaths`. Honestly labeled.

## Unresolved Questions

(none — design locked by blueprint ADR-1..5.)

## Test Plan

Unit (parser+activation+glob) → discovery integration (mkdtemp) → contract e2e (fixture repo, real snapshot) → regression (.cursor/rules) → example (deterministic, runs green). Full `pnpm typecheck && pnpm test && pnpm lint` green before review.

## DoD

- [ ] Spec `theokit-rules` in registry (prio 45); `rules-frontmatter` in parser union.
- [ ] Parser accepts paths+globs+alwaysApply+enabled; malformed→undefined.
- [ ] Path-scoped rule activates iff a contextPaths entry matches; alwaysApply always; scoped skipped when no signal.
- [ ] `contextPaths` on SendOptions threaded end-to-end.
- [ ] No new dependency (globToRegex reused/extracted).
- [ ] `.cursor/rules` regression green.
- [ ] typecheck + test + lint green; example runs; docs.md + docs site + CHANGELOG + changeset.
