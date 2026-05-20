# INDEX — Traceability Matrix

> Cross-reference table linking **23 SDK patterns** (in `../sdk-references/`)
> to their **anchor in `hermes-deep-dive/`** (this folder, feature-oriented)
> and to **primary Hermes source citations** (in `../../../referencia/hermes-agent/`).
>
> Built 2026-05-18 to close the traceability gap surfaced during status
> review: 16 deep-dive docs were feature-by-feature (Kanban, Skills,
> FTS5…), but 10 cross-cutting tactical patterns lived only in
> `sdk-references/` without an obvious anchor here. This file is the
> bridge. Every row gives the reader a runnable path: pattern doc →
> deep-dive doc (architectural context) → Hermes file/line (primary
> source).

## How to read this

- **Pattern**: file under `.claude/knowledge-base/sdk-references/<name>.md`
  describing the cross-cutting tactic.
- **Deep-dive doc**: file in this folder providing architectural
  context. `—` means the pattern is cross-cutting enough that no single
  feature owns it; the citation column gives the canonical Hermes
  source instead.
- **Hermes primary source**: path under `referencia/hermes-agent/`
  with the concrete Python implementation, or a Hermes release PR
  number when the citation is a commit, not a file.
- **SDK status**: roadmap status from `CLAUDE.md` § "SDK Patterns
  Roadmap" — ✅ DONE / ⚠️ PARTIAL / ❌ PENDING / 📚 CULTURAL.

---

## Persistence & State (6 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 1 | [atomic-write-pattern](../sdk-references/atomic-write-pattern.md) | [10-state-persistence](./10-state-persistence.md) | `tools/skill_usage.py:67-96` (canonical); `AGENTS.md:787,912-916` (discipline) | ✅ DONE |
| 2 | [file-lock-pattern](../sdk-references/file-lock-pattern.md) | [10-state-persistence](./10-state-persistence.md) | `tools/skill_usage.py:67-96`; `AGENTS.md:787,912-916` | ✅ DONE |
| 3 | [profile-isolation](../sdk-references/profile-isolation.md) | [10-state-persistence](./10-state-persistence.md) | `hermes_constants.py` (Python canonical); `AGENTS.md:866-928` (5 rules + PR #3575) | ✅ DONE |
| 4 | [schema-versioning](../sdk-references/schema-versioning.md) | [10-state-persistence](./10-state-persistence.md) (AD-9) | `hermes_state.py:36` (`SCHEMA_VERSION = 11`) | ✅ DONE |
| 5 | [sqlite-wal-fallback](../sdk-references/sqlite-wal-fallback.md) | [10-state-persistence](./10-state-persistence.md) (AD-3) | `hermes_state.py:128-183` (`apply_wal_with_fallback`) | ✅ DONE |
| 6 | [fts5-sanitization](../sdk-references/fts5-sanitization.md) | [04-cross-session-fts5](./04-cross-session-fts5.md); [10-state-persistence](./10-state-persistence.md) | `hermes_state.py:1797-1847` (6-step sanitizer); `hermes_state.py:253-306` (FTS5 schema) | ✅ DONE |

## Agent core loop (3 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 7 | [prompt-cache-discipline](../sdk-references/prompt-cache-discipline.md) | — (cross-cutting; referenced in [00-orientation](./00-orientation.md), [05-dialectic-user-model](./05-dialectic-user-model.md), [99-implementation-guide](./99-implementation-guide.md)) | `AGENTS.md:840-851` (discipline rule); `:849-851` (deferred-invalidation pattern, `/skills install --now` reference) | 📚 CULTURAL |
| 8 | [tool-call-failure-recovery](../sdk-references/tool-call-failure-recovery.md) | [00-orientation](./00-orientation.md):215-223 (failure modes list) | v0.2 #444 (DeepSeek JSON), v0.3 #1300 (parallel calls), v0.8 #5265 (type coerce) | ❌ PENDING |
| 9 | [compression-death-spiral](../sdk-references/compression-death-spiral.md) | — (cross-cutting; orientation references the loop) | `AGENTS.md:84-140` (synchronous loop + budget + grace call); v0.4 #1723, v0.7 #4750, v0.11 #10065, v0.11 #10472 (4 spirals fixed) | ❌ PENDING |

## Plugin & extension (3 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 10 | [plugin-contract-design](../sdk-references/plugin-contract-design.md) | [12-plugin-loader](./12-plugin-loader.md) | `hermes_cli/plugins.py:287` (`PluginContext`); `AGENTS.md:467-562` (3 discovery systems + Teknium's hard line) | ❌ PENDING |
| 11 | [tool-registry-pattern](../sdk-references/tool-registry-pattern.md) | [11-tool-registry](./11-tool-registry.md) | `tools/registry.py:151` (`ToolRegistry.register`) | ⚠️ PARTIAL (D24 covers `defineTool`) |
| 12 | [provider-as-plugin](../sdk-references/provider-as-plugin.md) | [07-provider-plugins](./07-provider-plugins.md) | `providers/base.py:21` (`ProviderProfile`); `providers/__init__.py` (register/discover) | ❌ PENDING |

## Background work (3 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 13 | [forked-agent-pattern](../sdk-references/forked-agent-pattern.md) | [03-autonomous-skills](./03-autonomous-skills.md) (end-of-turn fork is canonical use case) | `run_agent.py:4230` (`_spawn_background_review`) | ❌ PENDING |
| 14 | [async-iterable-streaming](../sdk-references/async-iterable-streaming.md) | [02-runUntil-goal](./02-runUntil-goal.md):1-100 (Ralph loop uses async-iter judges) | `hermes_cli/goals.py:580` (`evaluate_after_turn`) | ⚠️ PARTIAL (D39 covers `streamObject`) |
| 15 | [judge-call-pattern](../sdk-references/judge-call-pattern.md) | [02-runUntil-goal](./02-runUntil-goal.md) (judge is core of `runUntil`) | `hermes_cli/goals.py:580` (`evaluate_after_turn`); `hermes_cli/goals.py:judge_goal` (verdict parsing) | ❌ PENDING |

## Security (3 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 16 | [secret-redaction-discipline](../sdk-references/secret-redaction-discipline.md) | [13-security-redaction](./13-security-redaction.md) | `agent/redact.py:60-69` (env snapshot); `:73-105` (pattern list) | ✅ DONE |
| 17 | [path-traversal-vectors](../sdk-references/path-traversal-vectors.md) | [13-security-redaction](./13-security-redaction.md) (security section covers both) | v0.2 #220, #65, #192, #63, #386, #61 (early vector closures); v0.5 #3250 (self-update zip-slip) | ❌ PENDING |
| 18 | [toctou-race-prevention](../sdk-references/toctou-race-prevention.md) | — (cross-cutting; touches state-persistence + security) | v0.4 #1716, #2406, #1908, #1726, #2154 (early closures); v0.13 #19874, #21176, #21194 (recurrence — TOCTOU is easy to re-introduce) | ⚠️ PARTIAL |

## Testing (3 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 19 | [testing-invariant-vs-snapshot](../sdk-references/testing-invariant-vs-snapshot.md) | [14-testing-strategy](./14-testing-strategy.md) (AD-6 full ban rationale) | `AGENTS.md:1033-1077` ("Do not write" / "Do write" examples); [00-orientation](./00-orientation.md):281-289 (translation rule) | 📚 CULTURAL |
| 20 | [hermetic-test-isolation](../sdk-references/hermetic-test-isolation.md) | [14-testing-strategy](./14-testing-strategy.md) | `tests/conftest.py:73-89` (`_isolate_hermes_home`); `AGENTS.md:970-985` (discipline statements) | ✅ DONE |
| 21 | [property-based-testing](../sdk-references/property-based-testing.md) | [14-testing-strategy](./14-testing-strategy.md):130-160 | `tests/stress/test_property_fuzzing.py` (kanban Python canonical) | ✅ DONE |

## Error handling (2 patterns)

| # | Pattern | Deep-dive doc | Hermes primary source | SDK |
|---|---|---|---|---|
| 22 | [error-context-surfacing](../sdk-references/error-context-surfacing.md) | — (cross-cutting; touches provider-plugins + transport) | v0.4 #2266 (canonical fix); `AGENTS.md` ("errors with provider + endpoint context") | ✅ DONE |
| 23 | [graceful-degradation](../sdk-references/graceful-degradation.md) | — (cross-cutting; instances in state-persistence + provider-plugins + execution-backends) | `hermes_state.py:128-183` (WAL→DELETE fallback); `providers/__init__.py:186` (`except ImportError` in discovery); `hermes_cli/plugins.py:69,1222,1245` (3 lazy-import sites); v0.5 #2796 (litellm removal); v0.13 #21193 (security probe pattern) | ✅ DONE |

---

## Why some patterns have `—` instead of a deep-dive doc

The 16 deep-dive docs are **feature-oriented** (one doc per Hermes
domain: Kanban, Skills, FTS5, Cron…). The 23 patterns in `sdk-references/`
are **tactic-oriented** — many are cross-cutting and don't belong to a
single Hermes feature:

- `prompt-cache-discipline` appears in every Hermes feature that
  mutates state (skills, memory, tools, profiles). No single doc owns
  it; the citation is the AGENTS.md discipline rule.
- `compression-death-spiral` is a property of `AIAgent.run_conversation`
  itself (the core loop). Lives in AGENTS.md, not a feature doc.
- `toctou-race-prevention` is a class of bugs that touched many areas
  over Hermes' history (5 closures in v0.4, 3 recurrences in v0.13).
  Cited via PR numbers because the lesson is the recurrence, not the
  fix.
- `error-context-surfacing` is a provider-transport concern that
  applies to every provider plugin; cited via the canonical fix PR
  (v0.4 #2266).
- `graceful-degradation` is a meta-pattern (lazy probe + fallback)
  that recurs in state, providers, plugins, telemetry. Cited via the
  three concrete instance sites in Hermes source.

When a pattern has `—`, the citation column is authoritative — that
PR number / line range is the actual primary source, not the deep-dive
doc.

## Coverage summary

- **23 patterns indexed** — 100% have a Hermes primary source citation
  (no circular or placeholder citations after the 2026-05-18 cleanup
  of `graceful-degradation`).
- **17 patterns map 1:1 to a deep-dive doc** — most persistence,
  plugin, background-work, testing, and security patterns have a
  feature owner.
- **6 patterns are cross-cutting** — `prompt-cache-discipline`,
  `compression-death-spiral`, `toctou-race-prevention`,
  `error-context-surfacing`, `graceful-degradation`, plus
  `tool-call-failure-recovery` (cited via orientation doc + PRs).

The cross-cutting ones DO have anchor mentions in `00-orientation.md`
and `99-implementation-guide.md` (search those two files for the
pattern slug to find the architectural context).

## Maintenance

When adding a new pattern to `sdk-references/`:

1. Add a row to the table in this file matching the section it
   belongs to.
2. Pick a feature owner in this folder, or set Deep-dive doc to `—`
   with a justification in the "Why" section above.
3. Cite a concrete Hermes file:line or release PR — never an internal
   ADR alone (circular).
4. Update the SDK Patterns Roadmap totals in `CLAUDE.md` if the
   pattern bumps the DONE/PARTIAL/PENDING count.
