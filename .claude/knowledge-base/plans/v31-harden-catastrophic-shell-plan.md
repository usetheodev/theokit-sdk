---
slug: v31-harden-catastrophic-shell
milestone_id: V3-1
created_at: 2026-06-23
goal: Harden @theokit/sdk-tools catastrophicShellReason to theocode's proven corpus
---

# Plan: V3-1 harden `catastrophicShellReason` (security)

> **v1.1 (2026-06-23):** absorbed edge-case MUST-FIX EC-1 (reconcile reason strings — adopt theocode's, update the SDK test's exact `.toBe` assertions) + EC-2 (port as a SUPERSET: keep the SDK's `chmod/chown -R` + extra device families; adopt theocode's stricter "any absolute non-scratch path is dangerous" rm-target rule and FLIP the SDK's `rm -rf /home/user/project/dist` allowed-case to blocked — the intended V3-1 security hardening) + EC-3 (adopt theocode's segment splitter incl. `&`/newline).

## Goal

> "Enable `@theokit/sdk-tools` `catastrophicShellReason` to block all 42 catastrophic commands in theocode's corpus (0 misses) while allowing all 24 legit commands (0 false-positives), measured by `pnpm --filter @theokit/sdk-tools test` passing the ported `shell-guard` corpus."

## Context

`@theokit/sdk-tools` `catastrophicShellReason` is a weaker subset of theocode's hardened shell-guard. An empirical probe (V2-2C-2, re-confirmed 2026-06-23) found **18 of 42** catastrophic commands MISS, 0 false-positives. The blueprint `v31-harden-catastrophic-shell` (SHIPPABLE_WITH_CAVEATS 89) maps every miss to a theocode rule and confirms (via codex cross-check) the category taxonomy is complete. This plan ports theocode's proven 143-LoC rule set into the SDK function, preserving its public API, gated by theocode's 42+24 corpus at 0/0.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Why it exists |
|---|---|---|
| `packages/sdk-tools/src/internal/shell-guard.ts` | ~206 | Defines `catastrophicShellReason` + `CatastrophicCommandError` (M3-2 guardrail) |
| `packages/sdk-tools/tests/shell-guard.test.ts` | existing | Unit tests for the guard — gains the theocode 42+24 corpus |

### Current callers / dependents

- `catastrophicShellReason` consumed by: `packages/sdk-tools/src/internal/command-policy.ts`, `packages/sdk-tools/src/shell-exec.ts`, re-exported via `packages/sdk-tools/src/index.ts`. The function SIGNATURE (`(cmd: string) => string | null`) and `CatastrophicCommandError` are UNCHANGED — callers are unaffected; only the rule coverage widens (more commands now return a reason).
- `CatastrophicCommandError extends ConfigurationError` (from `@theokit/sdk`) — kept as-is.

### Domain glossary

- **catastrophic command** — an effectively-irreversible/destructive shell command (disk wipe, force-push, `rm -rf /`, exfiltration, RCE).
- **guardrail (not a sandbox)** — best-effort regex backstop; bypassable by obfuscation. True isolation needs a container (out of scope).
- **corpus** — theocode's 42 blocked + 24 allowed test cases; the acceptance oracle.
- **segment** — a statement split on `;`/`&&`/`||`/`|`; the guard inspects every segment (C1).

### Architecture boundaries affected

Entirely inside `packages/sdk-tools/src/internal/` + its tests. No public-API signature change (per architecture.md § module cohesion — the exported contract is stable). No new dependency. POSIX `/bin/sh` only.

## Prior Art & Related Work

- **Blueprint `v31-harden-catastrophic-shell`** (SHIPPABLE_WITH_CAVEATS 89) — maps all 18 misses → theocode rules + 24 allowed → carve-outs.
- **theocode `shell-guard.ts`** (`.claude/knowledge-base/references/theocode-shell-guard/server-lib/shell-guard.ts`, 143 LoC, 2 security reviews) — the proven spec.
- **theocode corpus** (`.claude/knowledge-base/references/theocode-shell-guard/tests-unit/shell-guard.test.ts`, 42+24) — the acceptance oracle.
- **codex** guardian/exec-policy — taxonomy cross-check (no new category).

## Objective

Port theocode's catastrophic rules into the SDK's `catastrophicShellReason` so the 42+24 corpus passes 0/0, keeping the function signature + `CatastrophicCommandError`, zero new deps.

## ADRs

### D1 — Port theocode's proven rules wholesale; keep the SDK public API

**Decision:** replace the SDK's weaker rule set with theocode's regex rules (rm target-variants + flags-any-position + every-segment; git reset --hard; git clean -fd; command-sub/eval RCE; find -delete/-exec rm; truncate /dev; exfiltration secret×network), keeping the exported `catastrophicShellReason(cmd): string|null` + `CatastrophicCommandError`.

**Rationale:** theocode's guard is empirically proven (corpus 0/0, 2 security reviews); the SDK's misses 18/42 (Rule 9 — port a proven spec, don't re-derive). Alternative (incrementally patch the SDK's existing logic) rejected — higher risk of leaving a miss; the proven corpus + a clean port is the safety net.

### D2 — No new category beyond theocode's (YAGNI); no sandbox mechanism

**Decision:** do not add catastrophic categories beyond theocode's; do not adopt codex's sandbox/LLM mechanism.

**Rationale:** blueprint Q3 — codex names the same categories via a different mechanism; no regex-expressible category is missing. Adding speculative rules risks false-positives that break frictionless use. Alternative (mine codex sandbox rules) rejected — out of scope, different mechanism.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A ported regex over-blocks a legit command not in the 24-allowed corpus (new false-positive) | MEDIUM | The 24-allowed corpus encodes the known legit-lookalikes (`/tmp`, `--force-with-lease`, `dd if=/dev`, relative `find -delete`); port the carve-outs verbatim; any new FP is caught by the corpus test | implementer |
| A determined adversary bypasses the regex (obfuscation/base64/env-indirection) | LOW (documented) | The guard is a backstop, NOT a security boundary (kept in the file header); true isolation is the container follow-up — out of V3-1 scope | implementer |
| Existing SDK guard had rules theocode lacks (e.g., chmod/chown -R) — porting could drop them | LOW | Keep the SDK's extra checks (chmod/chown -R, device-redirect families) as a SUPERSET; the port ADDS theocode's rules, does not remove the SDK's broader device families | implementer |

## Unresolved Questions

(none — every decision is resolved at plan time. The rule set is the theocode spec; the oracle is the 42+24 corpus.)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | workspace | npm | `ConfigurationError` base for `CatastrophicCommandError` (unchanged) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | The guard is pure regex/string; no library needed (KISS) | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph

```
Phase 1 (corpus RED) ──▶ Phase 2 (port rules GREEN) ──▶ Phase 3 (Integration Validation)
```

Phase 2 depends on Phase 1 (the RED corpus must exist + fail first). Phase 3 depends on both.

## Phase 1: Corpus (RED)

### T1.1 — Port theocode's 42+24 corpus into the SDK test as the RED oracle

#### Objective
Add theocode's 42 blocked + 24 allowed cases to `packages/sdk-tools/tests/shell-guard.test.ts`; confirm 18 blocked cases FAIL against the current function.

#### Why this step (action + reasoning)
Action: copy the table-driven corpus (blocked `[cmd, RegExp]` + allowed `[cmd]`) into the SDK test. Reasoning: the corpus is the acceptance oracle (blueprint Q4); writing it first (RED) proves the 18-miss gap concretely and guards the port — TDD per testing.md.

#### Evidence
Probe 2026-06-23: 18/42 miss, 0 FP. Corpus at `.claude/knowledge-base/references/theocode-shell-guard/tests-unit/shell-guard.test.ts`.

#### Files to edit
- `packages/sdk-tools/tests/shell-guard.test.ts` — add the corpus describe blocks.

#### Deep file dependency analysis
The test imports `catastrophicShellReason` from `../src/internal/shell-guard.js` (existing import). Adding cases is additive; existing SDK tests stay.

#### TDD
```
test_shell_guard_corpus_blocks_all_42 — every blocked case returns a truthy reason matching its category regex. RED: 18 currently fail.
test_shell_guard_corpus_allows_all_24 — every allowed case returns null. RED-check: all 24 currently pass (0 FP), must stay 0 after the port.
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Pure synchronous string screening, no shared state, no async.

#### Acceptance Criteria
- `test_shell_guard_corpus_blocks_all_42` exists and (pre-port) shows exactly 18 failures.
- `test_shell_guard_corpus_allows_all_24` exists and shows 0 failures.

#### DoD
- The corpus is in the SDK test file; running it pre-port reproduces the 18-miss probe.

## Phase 2: Port rules (GREEN)

### T2.1 — Port theocode's catastrophic rules into `catastrophicShellReason`

#### Objective
Add the missing rules so all 42 block and all 24 still pass; keep the signature + `CatastrophicCommandError`.

#### Why this step (action + reasoning)
Action: in `shell-guard.ts`, add destructive-git (reset --hard, clean -fd), command-sub/eval RCE (`$(`/`<(`/eval/source with curl/wget/fetch), find -delete/-exec rm, truncate /dev, exfiltration (secret×network), and strengthen the rm screen (target variants `~/sub`/`/usr/local`/`../..`/`$HOME/x`, flags-after-operand). Reasoning: these are the theocode rules the blueprint mapped to the 18 misses (Q1), with the carve-outs preserved (Q2) so the 24 allowed stay green.

#### Evidence
Blueprint Q1 rule table (file:line per category) + Q2 carve-outs.

#### Files to edit
- `packages/sdk-tools/src/internal/shell-guard.ts` — port theocode's rules as a SUPERSET (add missing categories; keep `chmod/chown -R` + extra device families; adopt theocode's segment splitter incl. `&`/newline — EC-3; adopt theocode's reason strings — EC-1).
- `packages/sdk-tools/tests/shell-guard.test.ts` — reconcile: update existing exact `.toBe(reason)` assertions to the ported reason strings (EC-1); FLIP the `rm -rf /home/user/project/dist` allowed-case to blocked (EC-2 rm-target policy); add the `&`/newline split test (EC-3).

#### Deep file dependency analysis
Signature unchanged → `command-policy.ts`/`shell-exec.ts`/`index.ts` callers unaffected (they check truthy/null only). EC-2: port is a SUPERSET — KEEP the SDK's `permCheck` (chmod/chown -R) + broader device families (`mmcblk|disk|loop|dm-`); ADOPT theocode's stricter rm-target rule (any absolute non-`/tmp` path dangerous), which intentionally flips `/home/user/project/dist` to blocked (the V3-1 security-hardening choice, ADR D1). EC-1: adopting theocode's reason strings requires updating the existing SDK test's exact `.toBe` assertions (the strings widen; the corpus uses `.toMatch(/category/)`).

#### TDD
```
(GREEN of T1.1) test_shell_guard_corpus_blocks_all_42 — now 0 failures (all 42 block, matching theocode reason regexes).
test_shell_guard_corpus_allows_all_24 — still 0 failures (carve-outs preserved).
test_shell_guard_preserves_sdk_extras — chmod -R / on a root path, chown -R, and an extra device family (e.g. > /dev/mmcblk0) still block (EC-2 superset not regressed).
test_shell_guard_rm_target_policy_blocks_absolute — rm -rf /home/user/project/dist now blocks (EC-2 hardening); rm -rf node_modules / ./build / /tmp/x still allowed.
test_shell_guard_splits_on_background_and_newline — a dangerous rm after `&` or a newline blocks (EC-3 splitter).
test_shell_guard_signature_unchanged — catastrophicShellReason('') returns null; return type string|null (public-contract regression guard).
```

#### Concurrency tests (only when applicable)
(none — single-threaded). The function is pure; no shared state, no async added.

#### Acceptance Criteria
- `pnpm --filter @theokit/sdk-tools test` passes the full corpus (42 block, 24 allow).
- `catastrophicShellReason` signature + `CatastrophicCommandError` unchanged (existing SDK tests green).

#### DoD
- Corpus 0/0; existing SDK shell-guard tests still green; biome + tsc clean.

## Coverage Matrix

| Requirement (Goal / blueprint) | Task(s) |
|---|---|
| Block all 42 catastrophic (0 misses) | T1.1 (oracle), T2.1 (rules) |
| Allow all 24 legit (0 false-positives) | T1.1 (oracle), T2.1 (carve-outs) |
| Keep public API (`CatastrophicCommandError`, signature) | T2.1 |
| Zero new dependency | T2.1 |
| Integration: corpus green end-to-end | Phase 3 |

100% — every Goal/blueprint requirement maps to ≥ 1 task.

## Failure scenarios (when I/O external)

(none — no external I/O touched. The guard is a pure synchronous string screen; it performs no network, disk, or process I/O. It SCREENS commands but never executes them.)

## Global Definition of Done

- [ ] All tasks committed; all DoD checkboxes true.
- [ ] `pnpm --filter @theokit/sdk-tools test` green (corpus 42 block + 24 allow + existing tests).
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` (tsc) clean.
- [ ] biome lint clean on the touched files.
- [ ] No public-API signature change (callers unaffected).
- [ ] CHANGELOG `[Unreleased]` updated (packages/sdk-tools or workspace).
- [ ] changeset `@theokit/sdk-tools` minor.

## Final Phase: Integration Validation (MANDATORY)

### Execution
- Run `pnpm --filter @theokit/sdk-tools test` (full corpus + existing), `pnpm --filter @theokit/sdk-tools typecheck`, biome lint.
- Confirm the probe (42+24) now reports 0 misses / 0 false-positives.

### Acceptance Criteria
- Corpus 0/0; existing SDK tests green; typecheck + lint clean.

### If Validation Fails
Return to T2.1; do NOT emit `IMPLEMENTATION_COMPLETE` until the corpus passes 0/0.
