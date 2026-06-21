# Review: m3-catastrophic-shell

**Date:** 2026-06-20
**Reviewers (spawned agents):** 5 — architecture, test-auditor, wiring-validator, cross-validation, domain-security (general-purpose, opus-class)
**Findings (initial):** 1 BLOCKER, 3 HIGH (device-redirect dead regex counted BLOCKER by cross-val / HIGH by tests+security; CatastrophicCommandError orphan export HIGH), 4 MEDIUM, 2 LOW (acceptable-by-contract), several INFO
**Findings (after fix `3a18409`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM (all production defects fixed with regression tests), advisory LOW/INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-catastrophic-shell-2026-06-20/findings/*.md`.

## Scope reviewed

Commits `09bc25c` (T1.1 guardrail primitive) + `9a7ab99` (T2.1 wiring) + review-fix `3a18409`, on `develop` vs `main`. Files: `packages/sdk-tools/src/internal/shell-guard.ts`, `shell-exec.ts`, `index.ts`, `tests/shell-guard.test.ts`, `tests/shell-exec.test.ts`, `docs.md`, root `CHANGELOG.md`, `.changeset/m3-catastrophic-shell.md`.

## BLOCKER / HIGH findings (production defects — RESOLVED in `3a18409`)

### [BLOCKER/HIGH → FIXED] `DEVICE_REDIRECT` regex was dead — `> /dev/sda` never blocked
- Flagged by: cross-validation (BLOCKER), test-auditor (HIGH), domain-security (HIGH F1)
- file: `packages/sdk-tools/src/internal/shell-guard.ts` (original `DEVICE_REDIRECT`)
- detail: `…(?:sd|nvme|hd|vd|mmcblk|disk)\b` placed the `\b` right after the family token; a real node (`/dev/sda`, `/dev/nvme0n1`) continues with a word char, so the word→word transition is NEVER a boundary → the regex matched only the unusable bare prefix `/dev/sd`. `echo x > /dev/sda` returned `null`. A documented headline pattern (docs.md, changeset, CHANGELOG, blueprint all claimed "device redirects") did not fire, AND zero tests covered it (mutation deleting `redirectCheck` survived 100% of the suite).
- **fix (`3a18409`):** regex → `/[>]\s*\/dev\/(?:sd|nvme|hd|vd|mmcblk|disk|loop|dm-)\w*/` (matches the trailing device id). +2 tests (`echo x > /dev/sda`, `cat z > /dev/nvme0n1` block) + 1 negative (`> /dev/null` allowed). Verified end-to-end.

### [HIGH → FIXED] `CatastrophicCommandError` was an orphan export (wiring pillar (a) failed)
- Flagged by: wiring-validator (HIGH), architecture (LOW)
- file: `packages/sdk-tools/src/internal/shell-guard.ts:18` (class) + `shell-exec.ts` (handler returned a literal JSON string, never constructing the class)
- detail: the typed error was exported from the barrel but never instantiated in any production path (only in a self-referential test) — contrast `SsrfBlockedError`, thrown from 5 sites in `network-guard.ts`. Violated `no-stubs-no-mocks-no-wired.md` §3 (every exported class needs a real caller). knip could not catch it (public barrel export).
- **fix (`3a18409`):** the `createShellTool` handler now constructs `new CatastrophicCommandError(reason)` and uses `err.code` as the single source of the `"catastrophic_command"` string (mirrors `web_fetch`'s `SsrfBlockedError` handling) — the class is now reachable from production AND the literal is DRY'd.

## MEDIUM findings (false negatives on claimed patterns — RESOLVED in `3a18409`)

- **[FIXED] `rm -rf /etc` / `/usr` / `/home` / `/var` / `/boot`** (domain-security F2, cross-val M1): the guard claimed "root path" but `isRootishPath` only matched literal `/`. Top-level system dirs are realistically catastrophic (and `rm -rf /etc` actually executes where GNU `rm -rf /` is refused). **fix:** `SYSTEM_DIR` regex added to `isRootishPath` + trailing-slash normalization. +1 test.
- **[FIXED] `chown -R user /` not checked** (domain-security F3, cross-val L1): only `chmod` was screened. **fix:** `chmodCheck` generalized to `permCheck` (chmod|chown). +1 test.
- **[FIXED] `git push origin +main` (+refspec force)** (domain-security F4): the `+refspec` force form bypassed the flag-only check. **fix:** `gitForceCheck` also flags a `+refspec` operand. +1 test.
- **[FIXED] Vacuous `toBeTruthy` assertions** (test-auditor MEDIUM): positive cases did not pin the reason string (reason-swap mutations survived). **fix:** every positive guard test now asserts the exact reason; +`$HOME`/`${HOME}`, `;`/`||` chain, benign-pipe, bare-`mkfs`, operand-first-`dd` coverage. Guard suite 16 → 25 tests.

## LOW / INFO (advisory — accepted by the guardrail contract)

- domain-security F5 (LOW): `sh -c "rm -rf /"` nested-shell payload is not re-screened — documented obfuscation/indirection, out of scope per ADR D5. A code comment was added in `catastrophicShellReason` making the intentional limitation explicit.
- domain-security F6 (LOW): `rm${IFS}-rf${IFS}/` runtime-variable obfuscation — out of scope per ADR D5 (no variable expansion at parse time). Accepted.
- INFO confirmations: SRP/cohesion + DIP + OCP (extensible `SEGMENT_CHECKS`) clean (architecture); network-guard pattern mirrored on all four axes; pyramid balance correct + opt-out test (`git push --force` in an empty temp dir) safe & deterministic, no test spawns a dangerous command (test-auditor); all 6 ADRs honored + Coverage Matrix 8/8 + zero new deps (cross-validation); zero false positives across a 41-case adversarial matrix — command-position design is sound (domain-security).

## Quality gate re-validation (after `3a18409`)

- Full sdk-tools suite: 21 files / **199 passed, 0 failed** (+30 from M3-2: 25 shell-guard + 5 shell-exec guardrail/barrel).
- typecheck exit 0; Biome clean (49 files, 0 warnings — `${HOME}` literal suppressed with a justified `biome-ignore`; complexity ≤ 10); knip clean; build emits ESM+CJS+DTS; code-quality PASS.
- Adversarial re-verification of all flagged bypasses: 9 should-block now block, 8 should-allow stay allowed — "ALL GOOD", no over-block regression.

## Edge-case coverage

Plan EC-1 (chain/sudo/fork-bomb-whole-match), EC-2 (rm target variants), EC-3 (empty/comment input → null), EC-4 (command-position mention not over-blocked) all covered, plus the review-added device-redirect, system-dir, `$HOME`, `;`/`||` chain, chown, `+refspec`, and benign-pipe cases.

## Verdict rationale

0 BLOCKER, 0 HIGH. The dead device-redirect regex (the one genuine correctness BLOCKER) and the orphan-export HIGH are FIXED in `3a18409` with regression tests — not deferred (goal: no re-work, all DoDs validated). The 3 MEDIUM false-negatives on claimed patterns and the weak-assertion gap are likewise fixed. Remaining items are out-of-scope LOW (documented obfuscation) + INFO confirmations. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — secure-by-default behavior change with a documented `allowCatastrophic` opt-out). Then continue M3 with M3-3 (repo-map).
