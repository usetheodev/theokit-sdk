# Discovery Plan: V3-1 harden `catastrophicShellReason`

> **Version 1.0** — Investigates the exact rule set `@theokit/sdk-tools` `catastrophicShellReason` must gain to match theocode's hardened shell-guard (the proven spec), validated by theocode's 42-blocked + 24-allowed corpus, plus a cross-check against codex's exec-policy/guardian to confirm the catastrophic-category taxonomy is complete. Output blueprint feeds `/to-plan` for the port.

**Slug:** `v31-harden-catastrophic-shell`
**Owner:** paulo
**Created:** 2026-06-23
**Time budget:** 3h (theocode-shell-guard 1.5h, codex 1.5h — ADR D1)

## Context

V3-1 (ROADMAP-v3, ALTO valor / segurança) hardens `@theokit/sdk-tools` `catastrophicShellReason`. An empirical probe (V2-2C-2, re-confirmed 2026-06-23) ran theocode's corpus against the SDK's current function: **18 of 42 catastrophic commands MISS, 0 false-positives**. Misses span: `rm` of `~/sub`/`/usr/local`/`../..`/separated `-r -f`/flags-after-operand; `git reset --hard`; `git clean -fd`; secret-file exfiltration (`cat .env | curl`, `tar ~/.aws | nc`); command-substitution RCE (`eval "$(curl)"`, `. <(curl)`, `bash -c "$(curl)"`); `find / -delete` / `-exec rm`; `truncate /dev/sda`. The theocode guard (143 LoC, hardened across 2 security reviews) is the proven spec; adopting the SDK's weaker subset would regress security.

## Objective

Specify the precise rules + regexes the SDK's `catastrophicShellReason` must gain to pass theocode's corpus (42 blocked + 24 allowed) at **0 misses, 0 false-positives**, preserving the SDK's public API (`CatastrophicCommandError`, segment-aware design). Success: blueprint maps every one of the 18 misses to a concrete rule, and codex cross-check confirms no catastrophic CATEGORY is missing from the taxonomy.

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/theocode-shell-guard/` | `server-lib/shell-guard.ts`, `tests-unit/shell-guard.test.ts` | The proven spec (143 LoC) + the 42+24 corpus — the authoritative port target |
| `.claude/knowledge-base/references/codex/` | `codex-rs/core/src/exec_policy.rs`, `codex-rs/core/src/guardian/policy.md` | Independent agent shell-execution guard — cross-check the catastrophic-category taxonomy |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/codex/codex-rs/tui`, `exec-server`, `mcp*` | Not the command-danger policy |
| codex sandbox/seccomp layers | codex sandboxes execution (different mechanism); V3-1 is a regex backstop, not a sandbox |
| `.claude/knowledge-base/references/theocode-eval` | Eval harness, unrelated to shell-guard |
| Windows PowerShell command screening | POSIX `/bin/sh` only (SDK header scope) |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** theocode-shell-guard 1.5h (read the 143-LoC spec + map each of the 18 misses to its rule), codex 1.5h (read exec_policy + guardian/policy.md to cross-check the taxonomy).

**Rationale:** theocode is the closer analog (same function name + same corpus, proven 0/0) so it grounds the port; codex is the independent second source to confirm completeness of the category set (≥2-source rule). Alternatives considered: theocode-only (rejected — single source; codex catches a missing category if one exists).

**Stop condition — per question:** if a file doesn't answer the question in its scoped dir, record "not found in scope" and continue; never fabricate.

**Stop condition — per project:** budget exhausted ⇒ mark remaining questions BLOCKED; if all questions are `done`/`blocked`, emit honest blocked report.

**Consequences:** the blueprint maps every miss to a rule; codex cross-check is bounded.

### D2 — Investigation depth

**Decision:** read theocode `shell-guard.ts` + corpus end-to-end (small); grep-then-read codex's exec_policy/guardian for the category taxonomy (codex core is large).

**Rationale:** the port needs the exact theocode regexes (read fully); codex only needs its category list (grep-bounded). Alternative (read all codex) rejected — out of budget, low marginal value.

**Consequences:** Q3's taxonomy-completeness verdict is grounded, not guessed.

## Research Questions

- **Fase A (broad)** — grep/ast map. **Fase B (deep)** — Read each hotspot for the exact rule.

| # | Question | Corner | Reference project(s) | Fase A (broad — grep map) | Fase B (deep — Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Which exact regexes/predicates does theocode use for each catastrophic category (rm-target variants, destructive-git, exfiltration, command-sub RCE, find-delete, device-wipe)? | techniques | `.claude/knowledge-base/references/theocode-shell-guard/` | `grep -nE 'function|test|RegExp|/.*/' theocode-shell-guard/server-lib/shell-guard.ts` | Read `shell-guard.ts` fully; extract each rule + its regex | Rule table: category → regex → covered corpus cases, with `file:line` |
| Q2 | How does theocode keep false-positives at zero (the 24 allowed: `/tmp`, `--force-with-lease`, `dd if=/dev/...`, relative `find -delete`)? | techniques | `.claude/knowledge-base/references/theocode-shell-guard/` | `grep -nE 'SAFE_|/tmp|force-with-lease|/dev/null|allow' theocode-shell-guard/server-lib/shell-guard.ts` | Read the safe-path / lease / device-source carve-outs | The carve-out rules that prevent each of the 24 allowed from blocking |
| Q3 | Does codex's exec-policy/guardian flag any catastrophic CATEGORY absent from theocode's taxonomy (e.g., a destructive op theocode misses)? | techniques | `.claude/knowledge-base/references/codex/` | `grep -niE 'rm|dd|mkfs|/dev|git (reset|clean|push)|curl|wget|eval|exfil|destructive|chmod|chown' codex/codex-rs/core/src/guardian/policy.md codex/codex-rs/core/src/exec_policy.rs` | Read the destructive/exfiltration sections of guardian/policy.md | Verdict: theocode taxonomy complete vs codex, OR a named extra category to add |
| Q4 | How does theocode test the guard without executing commands (the 42+24 corpus shape)? | tests | `.claude/knowledge-base/references/theocode-shell-guard/` | `grep -nE 'blocked|allowed|toMatch|toBeNull|describe|it\(' theocode-shell-guard/tests-unit/shell-guard.test.ts` | Read the corpus test structure | Test recipe: table-driven blocked/allowed with regex assertions |
| Q5 | What runtime deps does the theocode guard need (does it need any library)? | deps | `.claude/knowledge-base/references/theocode-shell-guard/` | SKIP Fase A — read the imports at the top of `shell-guard.ts` | Read the import block | Dep list (expected: zero — pure regex/string) |
| Q6 | How is the guard exercised (the test command)? | tools | `.claude/knowledge-base/references/theocode-shell-guard/` | SKIP Fase A — the corpus is a vitest file | Note the vitest test shape | The one command to run the corpus (vitest) |

Counts: Techniques 3 (Q1-Q3), tests 1 (Q4), deps 1 (Q5), tools 1 (Q6) = 6 questions (5-10 budget; ≤3/corner; ≥1/corner).

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | the cited `.claude/knowledge-base/references/{...}` path exists | Mark Qx BLOCKED "path not found", continue |
| Q1 completeness | every one of the 18 probe misses maps to exactly one rule in the answer | Re-iterate Q1 until all 18 mapped |
| Q3 honesty | if codex flags no extra category, the blueprint states "taxonomy complete vs codex" explicitly (no overclaim) | Record the honest verdict |
| Before promising complete | all 4 corners populated | Refuse promise, continue |

## Acceptance Criteria

- All 6 questions answered; every citation resolves under `.claude/knowledge-base/references/`.
- The blueprint maps all 18 probe misses → concrete rules (Q1) AND all 24 allowed → carve-outs (Q2).
- ≥ 2 independent references cited for Techniques (theocode AND codex).
- Q3 states an explicit taxonomy-completeness verdict vs codex.
- An ADR records the SDK keeps its public API (`CatastrophicCommandError`) while adopting theocode's rules.

## Global Definition of Done

Scored by `/discover-confidence` against `discover-blueprint-golden-rule.md`: no empty coverage corner, no fabricated citation, ADRs present. Target ≥ SHIPPABLE_WITH_CAVEATS before `/to-plan`.
