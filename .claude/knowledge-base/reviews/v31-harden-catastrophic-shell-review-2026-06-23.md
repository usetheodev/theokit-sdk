# Review — v31-harden-catastrophic-shell (V3-1)

**Date:** 2026-06-23 · **Slug:** v31-harden-catastrophic-shell
**Commits reviewed:** `986f340` (feat) + `99d2b2a` (test LOW absorption) on `develop` (theokit-sdk)
**Reviewers:** 3 independent fresh-eyes agents (security-correctness · port-fidelity/regression/API · test-quality)
**Verdict:** **READY_TO_MERGE** (3 PASS lenses, 0 BLOCKER, 0 HIGH; LOW findings absorbed or documented).

## Overview
V3-1 (ROADMAP-v3, ALTO/segurança) hardens `@theokit/sdk-tools` `catastrophicShellReason`. The `shell_exec` guardrail missed 18 of 42 catastrophic commands (empirical probe). theocode's security-reviewed guard (42-blocked + 24-allowed corpus, 0/0) was ported as a SUPERSET — adding 5 categories (git reset --hard, git clean -fd, command-sub/eval RCE, find -delete/-exec rm, secret-file exfiltration) + a stronger rm screen, keeping the SDK's extras (recursive chmod/chown on root, extra device families, `//` collapse) and extending the segment splitter to `&`/newline. Public API unchanged; zero new dependency. Re-probe: **0 misses / 0 false-positives**.

## Lens verdicts

### Security correctness — PASS
Every theocode rule ported faithfully and as a strict SUPERSET (no rule weaker than theocode). 47-probe adversarial sweep found 4 LOW residual bypasses (`sudo -u root rm`, `/bin/rm`, `~user`, download-then-exec across segments) — all **inherited verbatim from the security-reviewed theocode spec** (verified identical against the reference), all the deep-obfuscation class the guard header explicitly disclaims, none V3-1 regressions. rm-target hardening (any absolute non-`/tmp` path now blocks) is intentional + documented (ADR D1/EC-2). Corpus 0/0; full suite green.

### Port fidelity / regression / API stability — PASS
All 3 SDK-specific screens survive the port: recursive chmod/chown on root (`checkPerm`), broader device families (`sd|nvme|hd|vd|mmcblk|disk|loop|dm-`), `//` collapse. `catastrophicShellReason(cmd): string|null` + `CatastrophicCommandError` (name/code/base) unchanged; callers (`command-policy.ts`, `shell-exec.ts`, `index.ts`) consume reason as opaque truthy/null → unaffected. Reason strings reconciled via shared consts (no stale `.toBe`). Full suite 360→361 green; typecheck + `biome check` clean.

### Test quality — PASS
Corpus is a 1:1 faithful port of theocode's (42+24, 0 dropped/altered, regexes match). Non-tautology PROVEN by mutation (disabling exfiltration → 5 red; removing `&`/newline splitter → 2 red; reverted byte-identical). EC-2 flip (`/home/user/project/dist` allowed→blocked) intentional + documented. SDK-specific cases retained with real assertions. All 8 `CategoryCheck`s have positive tests.

## LOW findings — absorbed (`99d2b2a`) or documented
1. (port-fidelity) test dropped the parent's 2 `biome-ignore` for `${HOME}` → went 0→2 warnings → **re-added** (0 warnings restored).
2. (test-quality) `checkPerm` asymmetric coverage (no allow/negative test) → **added** `chmod 644` / relative `chmod -R ./scripts` / `chown -R ./dist` allowed cases.
3. (test-quality/port) dropped comment-only `# just a comment`→null assertion → **restored**.
4. (security) 4 deep-obfuscation residual bypasses inherited from the theocode spec → **documented as known residuals** (the header disclaims them; adding speculative matching would diverge from the corpus-validated, twice-security-reviewed baseline — YAGNI). Optional future hardening for theocode itself, not a V3-1 blocker.

## Validation (all green)
Re-probe **0 misses / 0 false-positives** on the 42+24 corpus · `@theokit/sdk-tools` **361 tests** green (28 files) · `biome check` clean (0 warnings/errors) · `typecheck` clean · public API unchanged · zero new dependency · changeset `@theokit/sdk-tools` minor.

## Conclusion
The slice meets its Goal — `catastrophicShellReason` now blocks all 42 catastrophic commands and allows all 24 legit ones (0/0), porting theocode's twice-security-reviewed rules as a superset without changing the public API or adding a dependency. Faithful, regression-free, non-tautological tests; the review's own LOW findings were absorbed with full re-validation, and the inherited deep-obfuscation residuals are honestly documented (the guard is a backstop, not a sandbox). **Verdict: READY_TO_MERGE.**

## Loop-closure follow-up (out of this slice)
Per ROADMAP-v3 V3-1: theocode adopts `catastrophicShellReason` from `@theokit/sdk-tools` in `permission.plugin.ts`, deletes its local `shell-guard.ts`, and drops the `shell-guard` anti-reinvention baseline entry (3→2). That adoption happens in the theocode repo after this ships.
