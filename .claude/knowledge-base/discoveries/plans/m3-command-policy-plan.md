# Discovery Plan: M3-6 — Catastrophic shell at the agents/permission layer

> **Version 1.0** — Investigate how command-permission policies compose at the agents layer, to design `denyCatastrophicCommands(): CommandPolicy` + `isCommandAllowed(command, policies)` + `commandDenialReason(command, policies)` in `@theokit/sdk-tools` — a composable command-policy layer built ON TOP of the M3-2 `catastrophicShellReason` guardrail (already shipped). codex (`command_safety/is_dangerous_command.rs` + `is_safe_command.rs` — predicate composition), opencode (`permission/schema.ts` — allow/deny/ask rule effect), and the in-repo ACP permission-plugin (`packages/acp/src/permission-plugin.ts` — `pre_tool_call` veto) provide the precedent; the M3-2 `catastrophicShellReason` (reason-or-null) is the composed primitive. Blueprint output: the `CommandPolicy` type, the three function signatures, and the composition contract. NOTE: `@theokit/agents` does NOT exist — the policy lives in sdk-tools (where M3-2 lives) and is wired at the consumer's permission layer (KISS, no new package).

**Slug:** `m3-command-policy`
**Owner:** paulo
**Created:** 2026-06-21
**Time budget:** 2h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-6 (`docs/gap-audit/ROADMAP.md:128`, low sev, size S, Tema C, deps M3-2 ✅). Baseline (confirmed via Explore): `@theokit/agents` does NOT exist (workspace = sdk/sdk-tools/sdk-budget/sdk-cache/sdk-handoff/sdk-memory/acp/cli/memory-*). No `isCommandAllowed`/`denyCatastrophicCommands`/`CommandPolicy` anywhere (greenfield). M3-2 shipped `catastrophicShellReason(cmd): string | null` (`packages/sdk-tools/src/internal/shell-guard.ts:188`), already wired into `createShellTool`. The existing permission concept is ACP's `permission-plugin.ts` (`pre_tool_call` veto with ask/auto/deny modes). The roadmap scopes M3-6 as a COMPOSABLE policy layer (`denyCatastrophicCommands()` + `isCommandAllowed`) that builds on M3-2 — NOT a sandbox, NOT a new package. Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Objective

Decide the `CommandPolicy` type, `denyCatastrophicCommands()` (a policy composing `catastrophicShellReason`), `isCommandAllowed(command, policies)` (true iff no policy denies), and `commandDenialReason(command, policies)` (the first deny reason, for messaging) — backed by codex's safe/dangerous predicate composition, opencode's allow/deny rule effect, the in-repo ACP veto pattern, and the M3-2 reason-or-null primitive. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` + in-repo
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo ACP+M3-2)
- [ ] Recommendations give ≥ 1 concrete proposal per question (esp. the policy type + the three signatures)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/codex/` | `codex-rs/shell-command/src/command_safety/is_dangerous_command.rs`, `is_safe_command.rs` | predicate composition (dangerous + safe → allow decision) |
| `.claude/knowledge-base/reference/opencode/` | `packages/core/src/permission/schema.ts` | the allow/deny/ask rule `effect` model |
| (in-repo) `packages/acp/src/permission-plugin.ts` + `packages/sdk/src/internal/plugins/types.ts` | — | the existing `pre_tool_call` veto pattern the policy can plug into |
| (in-repo) `packages/sdk-tools/src/internal/shell-guard.ts` | — | the M3-2 `catastrophicShellReason` reason-or-null primitive being composed |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| Creating a `@theokit/agents` package | KISS — low/size-S task; the composable policy lives in sdk-tools next to M3-2 |
| Wiring the policy into ACP's plugin / a specific agent runtime | The policy is a pure predicate; the consumer wires it at their permission layer (the plugin glue is a consumer concern, YAGNI here) |
| A full ruleset engine (resource/action matching like opencode) | M3-6 is command-string policies only; a generic ruleset is over-scope |
| `.claude/knowledge-base/reference/*/{node_modules,dist,target}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** codex command_safety: 0.75h, opencode permission schema: 0.25h, in-repo ACP + M3-2 + sibling wrappers: 1h.
**Rationale:** codex's dangerous/safe predicate composition is the closest precedent; the M3-2 reason-or-null + the ACP veto are the load-bearing in-repo pieces.
**Stop condition — per question:** empty search after 3 variants → BLOCKED, continue. **Per project:** budget exhausted → mark remaining BLOCKED; if all done/blocked, emit BLUEPRINT_BLOCKED.
**Anti-pattern:** NEVER reimplement the catastrophic deny-list — M3-6 COMPOSES `catastrophicShellReason`, it does not duplicate it.

### D2 — Investigation depth
**Decision:** Read codex `is_dangerous_command.rs`/`is_safe_command.rs` for how predicates combine into an allow decision; read opencode `permission/schema.ts` for the effect vocabulary; map onto the M3-2 reason-or-null + the sibling composable-function shape (tool-guidance/tool-aci).
**Rationale:** the policy type + composition contract is the high-value output.
**Consequences:** the SDK ships a pure `CommandPolicy` (reason-or-null) + `isCommandAllowed`/`commandDenialReason` that compose any number of policies, with `denyCatastrophicCommands()` as the M3-2-backed default; the optional plugin glue is documented, not shipped.

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do codex / the in-repo ACP TEST command-permission decisions? | tests | codex, in-repo | Grep codex command_safety tests + ACP permission-plugin tests | Read codex `is_dangerous_command.rs` tests + `packages/acp` permission tests | Table → SDK RED tests (catastrophic cmd denied; safe cmd allowed; multi-policy first-deny-wins; empty policy list allows all) |
| Q2 | What does a command policy DEPEND on? Zero deps (compose M3-2)? | deps | codex, in-repo | Read codex command_safety imports + shell-guard exports | Confirm the policy only calls `catastrophicShellReason` + plain array ops | Verdict: zero new deps — compose M3-2 + Array.every/find; codex uses Rust std |
| Q3 | What is the policy TYPE + the three function signatures? | tools | codex, opencode, in-repo | Read opencode `permission/schema.ts` effect + M3-2 reason-or-null | Read `shell-guard.ts:188` + the sibling composable wrappers (tool-guidance/tool-aci) | Module shape → `type CommandPolicy = (command: string) => string | null` + `denyCatastrophicCommands()` + `isCommandAllowed(command, policies)` + `commandDenialReason(command, policies)` in `sdk-tools/src/internal/command-policy.ts` |
| Q4 | COMPOSITION TECHNIQUE: how do multiple policies combine into an allow/deny decision? | techniques | codex, opencode, in-repo | Read codex dangerous+safe combination + opencode rule effect | Decide: deny wins (first policy returning a reason denies); reason-or-null mirrors M3-2 | `commandDenialReason` returns the first non-null policy reason; `isCommandAllowed` = `commandDenialReason === null`; `denyCatastrophicCommands()` = `(cmd) => catastrophicShellReason(cmd)` |
| Q5 | INTEGRATION STANCE: where does the policy plug in (agents/permission layer) without a new package or runtime coupling? | techniques | in-repo (ACP) | Read ACP `permission-plugin.ts` `pre_tool_call` veto | Decide the policy stays a pure predicate; document how a consumer calls `isCommandAllowed` inside a `pre_tool_call` hook | The policy is pure + framework-agnostic; the ACP/plugin glue is a documented consumer pattern, not shipped (KISS, no @theokit/agents) |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every cited path (reference + in-repo) exists | mark Qx BLOCKED, continue |
| After answering Qx | the Qx section has ≥ 1 citation | re-iterate (1 retry) |
| Q2 no-reimplement gate | the design COMPOSES `catastrophicShellReason` (M3-2) — it does NOT duplicate the deny-list | re-iterate; keep composition |
| Q4 deny-wins gate | the design states deny-wins (first policy returning a reason denies) + reason-or-null mirrors M3-2 | re-iterate; record the combine rule |
| Q5 no-new-package gate | the policy is a pure predicate in sdk-tools; NO `@theokit/agents` package is created; the plugin glue is documented not shipped | re-iterate; keep KISS placement |
| Before promising complete | all 4 corners populated + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 research questions answered OR marked BLOCKED with reason
- [ ] Every citation resolves (reference + in-repo)
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo ACP+M3-2)
- [ ] Blueprint proposes `CommandPolicy` + the three signatures + the deny-wins composition + the pure-predicate integration stance, backed by codex + ACP + M3-2
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations
- [ ] All 4 coverage corners populated
- [ ] ADRs cover: policy type, three signatures, deny-wins composition, compose-not-reimplement, pure-predicate placement (no new package)
