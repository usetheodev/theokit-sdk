# Discovery Plan: M3-2 — Catastrophic-shell guard

> **Version 1.1** (discover-edge-cases absorbed: EC-1 chaining/sudo + EC-2 curl|sh folded into halt-loop checkpoints; EC-3/EC-4 documented) — Investigate how codex (mature heuristic deny-list in `command_safety/`) and opencode (approval-based bash tool) handle dangerous shell commands, plus the in-repo `network-guard` (M3-1) security-primitive pattern + the `shell-exec` baseline, to design a `catastrophicShellReason(cmd)` segment-aware deny-list (GUARDRAIL, not sandbox/approval) wired default-on into `createShellTool` (opt-out `allowCatastrophic`). codex provides the deny-list technique precedent; opencode the orthogonal approval approach; network-guard the typed-error + pure-predicate + barrel-export shape. Blueprint output: the reason-returning signature, the screened patterns, segment splitting, the typed error, and wiring.

**Slug:** `m3-catastrophic-shell`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 3h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-2 (`docs/gap-audit/ROADMAP.md:122`, high sev, Tema C). Baseline (`packages/sdk-tools/src/shell-exec.ts:30-141`): `createShellTool` runs `spawn("/bin/sh", ["-c", command], {cwd, detached})` with timeout + output caps but ZERO command screening — an agent can run `rm -rf /`, `curl evil|sh`, `mkfs`, `dd`, a fork bomb, `git push --force`, or exfil. No `catastrophicShellReason`/deny-list anywhere. The freshest in-repo security primitive is `network-guard` (M3-1, `packages/sdk-tools/src/internal/network-guard.ts`): a pure predicate + `SsrfBlockedError extends ConfigurationError` + barrel export — the exact pattern M3-2 mirrors. codex's `command_safety/` is a mature deny-list precedent; opencode gates via approval (orthogonal). The roadmap scopes M3-2 as a GUARDRAIL (heuristic deny-list, default-on, opt-out) — NOT a sandbox or approval system (M3-6 later composes it at the agents layer via `denyCatastrophicCommands()`/`isCommandAllowed`, which do not exist yet). Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`.

## Objective

Decide `catastrophicShellReason(cmd)` signature, the screened pattern set, segment-aware splitting (`;`/`&&`/`||`/`|`, `sudo` prefix), the typed error, and the default-on wiring — backed by codex's deny-list, opencode's approach, and the network-guard pattern. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` + in-repo
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo network-guard)
- [ ] Recommendations give ≥ 1 concrete proposal per question (esp. the pattern set + segment splitting)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/codex/` | `codex-rs/shell-command/src/command_safety/` (`is_dangerous_command.rs`, `is_safe_command.rs`, `windows_dangerous_commands.rs`) | The mature deny-list precedent — exact dangerous patterns + the bash-lc segment parsing + sudo recursion |
| `.claude/knowledge-base/reference/opencode/` | `packages/core/src/tool/bash.ts` | The orthogonal approval-based approach (a bash tool that defers to a permission gate, no deny-list) — contrast for the guardrail-vs-approval ADR |
| (in-repo) `packages/sdk-tools/src/internal/network-guard.ts` + `shell-exec.ts` | — | The pattern to mirror (M3-1) + the baseline being hardened |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/adk-js/`, `crewAI/` | No shell tool / command screening found (baseline confirmed) |
| codex's SANDBOX (landlock/seccomp) + APPROVAL framework | M3-2 is a heuristic GUARDRAIL, not a sandbox/approval system (roadmap scope); only codex's deny-list (`command_safety/`) is in scope |
| `.claude/knowledge-base/reference/*/{node_modules,dist,target,build}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** codex command_safety: 1.5h, opencode bash: 0.5h, in-repo network-guard + shell-exec: 1h.
**Rationale:** codex's deny-list is the load-bearing technique source (deepest read); opencode is a quick contrast; the in-repo pattern is already known from M3-1.
**Stop condition — per question:** empty search after 3 variants → BLOCKED, continue. **Per project:** budget exhausted → mark remaining BLOCKED; if all done/blocked, emit BLUEPRINT_BLOCKED.
**Anti-pattern:** NEVER claim the SDK ships a sandbox/approval — M3-2 is a heuristic guardrail; that limitation is stated honestly.

### D2 — Investigation depth
**Decision:** Read codex's `command_safety/*.rs` end-to-end for the exact dangerous patterns + the segment/sudo handling; read opencode bash.ts for the approval contrast; map onto the network-guard pure-predicate + typed-error pattern.
**Rationale:** the deny-list content (which patterns) is the high-value output; codex is the authority.
**Consequences:** the SDK adopts a curated subset of codex's POSIX patterns (the repo runs `/bin/sh` on POSIX; Windows PowerShell patterns are out of scope for v1 — documented).

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does codex TEST its dangerous-command checks, and how does opencode test its bash tool? | tests | codex, opencode | Grep `#[test]` in `command_safety/` + opencode bash test | Read codex `is_dangerous_command.rs` tests (`rm_rf_is_dangerous` etc.) + opencode bash test | Table: test → asserted dangerous/safe → seeds the SDK RED tests (block rm -rf/curl|sh/mkfs/dd/fork-bomb/force-push; allow ls/echo) |
| Q2 | What does codex's deny-list depend on (a shell parser)? Can the SDK do segment-aware screening with zero deps? | deps | codex, opencode | Read codex `command_safety` imports + `parse_shell_lc_plain_commands` | Read the parsing path | Verdict: SDK uses a minimal in-house segment tokenizer (split on `;`,`&&`,`||`,`|`; strip `sudo`/`env` prefixes) — zero new deps (KISS); codex uses a Rust shell parser (heavier, not portable) |
| Q3 | What is the module/export shape of codex `command_safety` + opencode bash + the in-repo network-guard? | tools | codex, opencode, in-repo | Read module exports | Read `command_safety/is_dangerous_command.rs:7-29` + `network-guard.ts:20-141` + `shell-exec.ts:30-55` | Module shape → `catastrophicShellReason` lives in `sdk-tools/src/internal/shell-guard.ts`, exported from barrel, mirroring network-guard |
| Q4 | DENY-LIST PATTERN SET: which command patterns are catastrophic (rm -rf, mkfs, dd-to-device, fork bomb, force-push, chmod -R 777 root, pipe-to-shell)? | techniques | codex, in-repo | Read codex `is_dangerous_command.rs:7-175` (rm -rf, sudo recursion, find -exec, bash-lc) | Map codex's POSIX patterns onto the SDK + add curl-into-sh, wget-into-sh, mkfs, dd-of-device, fork bomb, git force-push, chmod -R 777 root | The catastrophic pattern set with reasons → drives the deny-list table |
| Q5 | SCREENING TECHNIQUE: segment-aware splitting (chains, sudo prefix, pipe-to-shell) + the reason-returning contract + the guardrail-vs-approval stance | techniques | codex, opencode, in-repo | Read codex sudo-recursion + bash-lc parsing + opencode approval | Read codex `is_dangerous_command.rs` segment logic + opencode `bash.ts` permission gate + network-guard predicate shape | Segment-split algorithm (on `;`/`&&`/`||`/pipe; strip sudo/env) + command-position matching + `catastrophicShellReason(cmd)` returns reason-or-null; guardrail (not sandbox/approval) |

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
| Q4 guardrail gate | the technique section frames a heuristic deny-list (NOT a sandbox/approval) + cites codex's `command_safety` patterns; states the segment-splitting | re-iterate; keep the guardrail framing |
| Q4 segment gate | the design handles command chaining (`;`/`&&`/`||`/`|`) + `sudo` prefix (a catastrophic command hidden after `&&` or behind `sudo` is still caught) | re-iterate; record the segment algorithm |
| EC-2 pipe-to-shell gate (Q4) | the design flags `curl`/`wget` piped into `sh`/`bash`/`zsh` | re-iterate; add the pipe-to-shell rule |
| Guardrail-honesty gate | the blueprint states the deny-list is a guardrail (bypassable), NOT a sandbox; matches on command-position not arbitrary substring (EC-3/EC-4) | re-iterate; keep the honest framing |
| Before promising complete | all 4 corners populated + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 4 research questions answered OR marked BLOCKED with reason
- [ ] Every citation resolves (reference + in-repo)
- [ ] Cross-cutting comparison populated (codex / opencode / network-guard)
- [ ] Blueprint proposes `catastrophicShellReason` signature + the pattern set + segment algorithm + typed error + wiring, backed by codex + network-guard
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations
- [ ] All 4 coverage corners populated
- [ ] ADRs cover: signature, pattern set, segment splitting, typed error, default-on wiring, guardrail-not-sandbox scope
