# Edge Case Review — v31-harden-catastrophic-shell

Date: 2026-06-23
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 3 (MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 0)

## MUST FIX

### EC-1: existing SDK test uses exact `.toBe(reason)` strings that differ from theocode's corpus regexes
- **Affected task:** T2.1
- **Family:** State / Format
- **Scenario:** `packages/sdk-tools/tests/shell-guard.test.ts` asserts exact reason strings (`RM` constant, `"curl/wget piped into a shell"`, `"git push --force"`, `"dd writing to a device"`, `"mkfs on a device"`). theocode's corpus asserts category REGEXes (`/force-delete/`, `/remote code execution/`, `/force-push/`, `/block device|disk/`) that match THEOCODE's strings, not the SDK's. If T2.1 adopts theocode's reason strings (needed to pass the corpus), every existing SDK `.toBe(...)` assertion FAILS; if it keeps the SDK's strings, the theocode corpus `.toMatch(...)` FAILS.
- **Impact:** The port cannot satisfy both suites without reconciliation; silent breakage of the existing 152-LoC SDK suite.
- **Suggested fix:** Adopt theocode's (more descriptive) reason strings AND update the existing SDK test's exact assertions to the new strings (or relax them to `.toMatch(/category/)`). Add a sub-step to T2.1: "reconcile reason strings — update `packages/sdk-tools/tests/shell-guard.test.ts` exact `.toBe` assertions to the ported strings."

### EC-2: porting must PRESERVE SDK-specific cases absent from theocode's corpus
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** The SDK guard blocks cases theocode's corpus does NOT cover: `chmod -R`/`chown -R` on root (`permCheck`), broader device families (`mmcblk|disk|loop|dm-`), `rm -rf //` (double-slash), and ALLOWS `rm -rf /home/user/project/dist` (a deep home subpath). A wholesale replacement with theocode's 143 LoC would DROP `chmod/chown -R` and the extra device families, and theocode's `rmTargetsDangerous` BLOCKS `~/` subpaths — which would now block `/home/user/project/dist`? (No — that's an absolute non-system path; theocode's `/^\/[^/]/` blocks ANY absolute path incl. `/home/user/...`). This is a behavior DIVERGENCE: theocode blocks `rm -rf /home/user/project/dist`, the SDK currently allows it.
- **Impact:** Dropping chmod/chown/device-extras regresses coverage; theocode's stricter absolute-path rm would block a case the SDK test asserts as allowed (`/home/user/project/dist`) → false-positive against the SDK's own corpus.
- **Suggested fix:** Port as a SUPERSET, not a replacement: (a) keep the SDK's `permCheck` (chmod/chown -R) + broader device families; (b) for the rm screen, reconcile the "allowed deep-home-subpath" case — EITHER drop the SDK's `rm -rf /home/user/project/dist` allowed-assertion (adopt theocode's stricter "any absolute path is dangerous", the security-hardened choice) OR add a workspace-relative carve-out. Decide in T2.1 and encode it; the corpus (both suites) is the oracle. Document the chosen rm-target policy in T2.1.

## SHOULD TEST

### EC-3: segment-splitting divergence (`&`, newline)
- **Affected task:** T2.1
- **Suggested test:** `test_shell_guard_splits_on_background_and_newline` — theocode's `commandSegments` splits on `&` and `\n` (`split(/&&|\|\||[;|&\n]/)`); the SDK's `splitSegments` splits on `&&|\|\||;|\|` (NOT bare `&` or `\n`). A command like `rm -rf /tmp/x & rm -rf /` or a newline-chained dangerous rm could slip the SDK splitter. Assert a `&`-backgrounded and a newline-chained dangerous rm both block (adopt theocode's splitter).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 3 | 2 | 1 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX — reason-string reconciliation + superset-not-replacement w/ rm-target policy decision; 1 SHOULD TEST — segment splitter. Absorb into v1.1, then implement.)
