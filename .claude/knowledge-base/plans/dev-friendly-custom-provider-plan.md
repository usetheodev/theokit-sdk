---
slug: dev-friendly-custom-provider
created_at: 2026-06-19
goal: Make custom LLM provider registration actually work end-to-end via the public Plugin protocol (fix the half-wired model-provider path), add the canonical defineProvider factory (Rule 9), and document + exemplify it — so a developer can plug Groq/Together/Fireworks/a private gateway without forking.
---

# Plan: Dev-Friendly — Wire + ergonomics + docs for custom LLM providers

> **Version 1.0** — Discover phase (cross-validation against adk-js + deep code read) found that the three "dev-friendly gaps" originally proposed (custom provider, agent composition, context compaction) are mostly ALREADY implemented. Composition = `createSquad`/`Workflow`/`subagent`/`@theokit/sdk-handoff`. Compaction = public `CompressionConfig`. The ONE genuine residual is custom-provider registration via plugins: the `Plugin { kind: "model-provider"; profile }` variant is public and aggregated by `PluginManager`, but the aggregated `providerProfiles` are **never consumed** — `registerProvider(` has zero call sites outside `internal/providers/`. So a `model-provider` plugin passed to `Agent.create({plugins})` is silently dropped (a `no-stubs-no-mocks-no-wired.md` violation). This plan WIRES it, adds the canonical `defineProvider` factory, documents it, and ships a worked example.

## Goal

> "A developer can register a custom OpenAI-/Anthropic-compatible LLM provider with `Agent.create({ model: { id: 'myprov/model' }, plugins: [defineProvider(profile)] })` and have `agent.send` route to it — proven by an integration test that resolves a custom provider through the real router (no internal imports), `defineProvider` unit tests, `pnpm --filter @theokit/sdk test` green, typecheck + biome clean, and `pnpm quality:dead` reporting zero new dead exports."

## Context

`registerProvider(profile)` + `ProviderProfile` exist and work (`internal/providers/registry.ts`). `ProviderProfile` is already exported from `index.ts:92`. The `Plugin` union (incl. `kind: "model-provider"`) and `definePlugin` are public. `PluginManager.#dispatchPlugin` pushes provider plugins into `aggregated.providerProfiles` (manager.ts:171). **But nothing reads that list back** — verified: `grep -rn '\.providerProfiles' packages --include='*.ts'` returns only the manager (decl/init/push); `registerProvider(` has no call site outside `internal/providers/`. The router (`real-local-run.ts:122 resolveProviderChain`) only sees builtins + file-discovered plugins from `~/.theokit/plugins/model-providers/`. The programmatic plugin path is half-wired.

## Baseline Context (current state)

Repo HEAD: `d34ef9c` (develop). Files touched:

| File | State | Role | Invariant |
|---|---|---|---|
| `packages/sdk/src/internal/runtime/local-agent/real-local-run.ts` | exists (~250 LoC) | builds provider chain via `resolveProviderChain` (line 122); has `pluginManager` in scope | existing routing behavior unchanged; only ADD registration of plugin profiles before chain resolution |
| `packages/sdk/src/internal/providers/registry.ts` | exists | `registerProvider` (idempotent, WARN on override) | signature + WARN behavior unchanged |
| `packages/sdk/src/internal/plugins/manager.ts` | exists | aggregates `providerProfiles` (line 171) | unchanged (already correct) |
| `packages/sdk/src/define-provider.ts` (NEW) | — | `defineProvider(profile, opts?) → Plugin` factory | mirrors `define-tool.ts` style |
| `packages/sdk/src/index.ts` | exists | public barrel | additions only |
| `packages/sdk/docs.md` | exists | canonical contract | additions only — new "Custom providers" section |
| `packages/sdk/CHANGELOG.md` | exists | per-package changelog | `[Unreleased] § Added` + `§ Fixed` |
| `examples/custom-provider/` (NEW) | — | worked example | env-gated real-LLM per `real-llm-validation.md` |

Current callers: `aggregated.providerProfiles` — **none** (the gap). `registerProvider` — `catalog-loader.ts`, `discovery.ts` only.

## Tasks

### Phase 1 — Wire the model-provider plugin path (the real fix)

#### Task T1 — register plugin-aggregated provider profiles before chain resolution
- **What:** In `real-local-run.ts`, before `resolveProviderChain({...})` (line ~122), iterate `options.pluginManager?.aggregated.providerProfiles ?? []` and call `registerProvider(entry.profile)` for each.
- **Why this step:** the profiles are aggregated but never registered, so the router's `getProviderProfile` never finds them. Registering before chain resolution is the minimal correct wiring (registerProvider is idempotent + WARN-on-override, safe to call each run).
- **TDD:** RED — `tests/providers/plugin-custom-provider.integration.test.ts`: build a `model-provider` plugin with an `authType: "none"` OpenAI-compat profile (`name: "custom-llm"`), call the real `real-local-run` provider-resolution path (or `Agent.create` + resolve), assert a client is resolved for `custom-llm`. Currently FAILS (profile never registered). GREEN after the registration loop.
- **Wiring triad:** (a) caller = the registration loop in `real-local-run`; (b) integration test = the new test exercising the real router; (c) runtime metric = one-shot debug line `registered N plugin provider profile(s)` behind existing stderr-warn convention OR a span attribute (reuse, no new dep).
- **Acceptance:** plugin-based custom provider resolves through the real router with NO `internal/` imports in the test's act phase for the resolution assertion.

### Phase 2 — Canonical factory + surface

#### Task T2 — `defineProvider(profile, opts?) → Plugin` factory
- **What:** new `src/define-provider.ts`: `export function defineProvider(profile: ProviderProfile, opts?: { version?: string }): Plugin` returning `{ name: profile.name, version: opts?.version ?? "1.0.0", kind: "model-provider", profile }`.
- **Why this step:** Inviolable Rule 9 — every agentic capability ships as a factory function (`defineTool`, `definePlugin`…). Custom provider authoring is such a capability; the factory removes the `kind` magic-string + name duplication and makes it discoverable.
- **TDD:** RED — `tests/define-provider.test.ts`: `defineProvider(profile)` returns a plugin with `kind: "model-provider"`, `name === profile.name`, `version === "1.0.0"` (default) / override respected, `profile` preserved by reference. GREEN after impl.
- **Acceptance:** `isCodePlugin(defineProvider(profile)) === true` (passes the existing runtime type-guard).

#### Task T3 — export `defineProvider` from `index.ts`
- **What:** add `export { defineProvider } from "./define-provider.js";` near `defineTool`/`definePlugin`.
- **Why this step:** the factory is useless if not on the public barrel (the very "sealed primitive" anti-pattern this plan closes).
- **TDD:** covered by an export-surface assertion in `tests/define-provider.test.ts` importing from the package barrel (`../../src/index.js`).
- **Acceptance:** `import { defineProvider } from "@theokit/sdk"` type-checks; `quality:dead` reports it as used (the example + tests import it).

### Phase 3 — Docs + example

#### Task T4 — docs.md "Custom providers" section
- **What:** document `defineProvider` + `ProviderProfile` fields + the `apiMode` table + the `provider/model` id-prefix routing, with a Groq (OpenAI-compat) snippet.
- **Why this step:** capability + factory are invisible without docs (grep of docs.md for "registerProvider/custom provider" is currently empty). docs.md is the canonical contract (CLAUDE.md rule).
- **TDD:** N/A (docs) — validated by the public-copy lint + manual review against the example compiling.
- **Acceptance:** docs.md section exists, references the real exported symbol names, and the example matches it.

#### Task T5 — worked example `examples/custom-provider/`
- **What:** minimal example registering a custom OpenAI-compat provider via `defineProvider` and sending one message; env-gated on a real key per `real-llm-validation.md` (no real key → prints the resolved provider + skips the live send with an honest message).
- **Why this step:** examples are the second contract; a worked example is how devs actually discover the feature.
- **TDD:** typecheck-only gate (example is not in the vitest suite); the registration/resolution path is covered by T1's integration test.
- **Acceptance:** example typechecks; documented as "real-LLM optional — registration/resolution demonstrated without a live call".

## Risks & Drawbacks

1. **Idempotent re-registration WARN noise.** `registerProvider` warns on override. Calling it every run for plugin profiles is fine for new names, but re-registering a builtin name would warn. Mitigation: only register plugin-contributed profiles (never builtins); document that overriding a builtin name intentionally warns (existing D107 behavior).
2. **Global registry mutation from a per-agent plugin.** `registerProvider` mutates a module-global `REGISTRY`. Two agents in one process with different custom providers share the registry. This matches existing builtin behavior (also global) and the file-discovery path; acceptable for v1, documented as a known constraint. A per-agent registry is out of scope (YAGNI).
3. **Routing requires the provider name to reach `primary`.** The user must use the `provider/model` id prefix or `providers.routes`. Documented in T4. Not a regression.

## Unresolved Questions

- Should there also be a `Theokit.registerProvider` global convenience (the existing test's `describe` name hints at it)? Deferred: the plugin path + `defineProvider` is the canon-aligned surface (no global service-locator). Revisit only if a non-plugin programmatic registration is requested. (none blocking)

## Test Plan

- Unit: `tests/define-provider.test.ts` — factory shape, defaults, override, type-guard pass, barrel export.
- Integration: `tests/providers/plugin-custom-provider.integration.test.ts` — `model-provider` plugin resolves through the real router (RED before T1, GREEN after).
- Regression: existing `tests/providers/register-custom-provider.test.ts`, `router.test.ts`, `manager.test.ts` stay green (no behavior change to builtins).
- Gates: `pnpm --filter @theokit/sdk typecheck`, `biome check`, `pnpm --filter @theokit/sdk test`, `pnpm quality:dead` (zero new dead exports — `defineProvider` is used by tests + example).

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| custom provider routes end-to-end via plugin | T1 (+ integration test) |
| canonical `defineProvider` factory exists | T2 |
| importable from `@theokit/sdk` | T3 |
| documented | T4 |
| worked example | T5 |
| no new dead code | T3 + quality:dead gate |
