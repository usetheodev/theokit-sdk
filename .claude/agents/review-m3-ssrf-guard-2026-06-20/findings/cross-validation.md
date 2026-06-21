---
agent: review-m3-ssrf-guard-cross-validation
review_target: main..HEAD for plan m3-ssrf-guard
plan: .claude/knowledge-base/plans/m3-ssrf-guard-plan.md
branch_head: dea79aa
implementing_commits:
  - 06e7b1c  # T1.1 + T1.2 (Phase 1 — network-guard primitives)
  - f7f67d0  # T2.1 (Phase 2 — wire into web_fetch + export + docs)
  - dea79aa  # audit-trail only (implementation/validation/code-quality logs)
plan_tasks_summary:
  total_tasks: 3
  fully_implemented: 3
  partial: 0
  missing: 0
  diverged: 0
acceptance_criteria_summary:
  total: 13
  satisfied: 13
  unverified: 0
  false_claims: 0
adr_compliance:
  total_adrs: 6
  respected: 6
  diverged_without_new_adr: 0
coverage_matrix:
  total_gaps: 8
  covered: 8
plan_drift:
  plan_edited_after_implement: false
  details: >
    Plan committed 2026-06-20 20:02:33 (40ec449). Implement started 2026-06-20
    20:05:38 (06e7b1c). Plan frozen 3 min before implement. No mid-flight edit.
deps:
  new_dependencies: 0
  detail: >
    packages/sdk-tools/package.json has NO `dependencies` key at all (undefined).
    network-guard.ts imports only node:dns/promises + node:net + @theokit/sdk
    (ConfigurationError, an existing peer dep). Zero new deps confirmed.
behavior_change_documented: true
verdict: READY_TO_MERGE
counts:
  BLOCKER: 0
  HIGH: 0
  MEDIUM: 1
  LOW: 1
  INFO: 2
---

# Cross-Validation — m3-ssrf-guard

Line-by-line audit of plan `m3-ssrf-guard-plan.md` against the implementation
(commits 06e7b1c Phase 1 + f7f67d0 T2.1; branch HEAD dea79aa). The plan is the
contract; every task, ADR, and Coverage-Matrix gap was checked semantically.

## Verdict

**READY_TO_MERGE.** All 3 tasks fully implemented, all 13 Acceptance Criteria
satisfied, all 6 ADRs honored, Coverage Matrix 8/8 closed, zero new deps,
behavior change documented in CHANGELOG + docs.md + changeset. No BLOCKER/HIGH.
Two non-blocking findings (1 MEDIUM scope, 1 LOW location) recorded below.

## Re-run evidence (this review, not trusting the implementation log)

| Check | Result |
|---|---|
| `vitest run tests/network-guard.test.ts` | 22/22 PASS |
| `vitest run tests/web-fetch.test.ts` | 11/11 PASS (5 existing + 6 new) |
| `vitest run` (full sdk-tools suite — regression) | 164/164 PASS, 20 files |
| `tsc --noEmit` (sdk-tools typecheck) | exit 0 |
| `biome check` on network-guard.ts + web-fetch.ts + index.ts | 3 files, 0 errors |
| `grep -c 'redirect: "manual"'` network-guard.ts | 3 (≥ 1 required) |

## Task-by-task

### T1.1 — `isBlockedIp` block-list + `SsrfBlockedError` → commit 06e7b1c

- **Files declared vs changed:** declared `network-guard.ts` (NEW) +
  `network-guard.test.ts` (NEW). Both present in 06e7b1c. No undeclared file.
- **Acceptance Criteria (4):**
  - [x] isBlockedIp tests 11/11 pass — verified (the 11 `it()` blocks in
    `describe("isBlockedIp")`, all green).
  - [x] `test_isBlockedIp_ipv4_mapped_unwraps` passes — `::ffff:127.0.0.1` /
    `::ffff:169.254.169.254` → true, `::ffff:8.8.8.8` → false. `ipv4Mapped()`
    handles both dotted and hex (`::ffff:7f00:1`) forms (network-guard.ts:66-77).
  - [x] `test_isBlockedIp_172_15_and_172_32_allowed` passes — CIDR boundary
    correct via `inV4Cidr` bitwise mask (network-guard.ts:43-46).
  - [x] biome clean — verified 0 errors.
- **DoD:** tests green + typecheck exit 0 — both verified.
- **D1 detail:** `SsrfBlockedError extends ConfigurationError` with
  `{ code: "ssrf_blocked" }` (network-guard.ts:20-28). `ConfigurationError`
  accepts `code?: string` (sdk/src/errors.ts:205-217) — type-valid. `isBlockedIp`
  is pure (no I/O), defaults non-IP → `true` (fail closed). MATCHES ADR D1.

### T1.2 — `resolveAndScreen` + `screenedFetch` → commit 06e7b1c

- **Files declared vs changed:** declared additions to `network-guard.ts` +
  `network-guard.test.ts`. Both present in 06e7b1c (T1.1 and T1.2 landed in the
  same Phase-1 commit — acceptable; the commit message references "M3-1 Phase 1").
- **Acceptance Criteria (5):**
  - [x] `vitest run tests/network-guard.test.ts` → 22/22 — verified exactly 22.
  - [x] `test_resolveAndScreen_blocks_if_any_record_private` passes — loops every
    resolved address, throws on first blocked (network-guard.ts:136-138). Resolve-all.
  - [x] `test_screenedFetch_blocks_redirect_to_private` passes — per-hop
    `resolveAndScreen` before each fetch (network-guard.ts:187-189).
  - [x] `grep -c redirect:"manual"` ≥ 1 — returns 3.
  - [x] biome clean — verified.
- **DoD:** 22/22 green + typecheck exit 0 — verified.
- **Plan count nuance (INFO, not a defect):** the plan's T1.2 TDD block lists 11
  RED tests but the AC says "22/22 (11 from T1.1 + 11 here)". The actual file has
  11 T1.1 + 11 T1.2 (6 resolveAndScreen + 5 screenedFetch) = 22. The literal
  per-test names in the plan match the implemented names 1:1 (EC-1 non-http,
  EC-2 dual-stack, EC-3 decimal all present). Count reconciles to 22. ✓
- **D3/D4/D5 detail:** `screenedFetch` sets `redirect:"manual"`
  (network-guard.ts:190), follows ≤ maxRedirects (default 5), re-screens each hop;
  non-http(s) `Location` throws `SsrfBlockedError` (network-guard.ts:153-155, EC-1);
  injectable `fetchImpl`/`lookup` (DIP). resolve-all-A-records implemented
  (network-guard.ts:134-139). IP-pinning is NOT present and NOT claimed — matches
  D4 (deferred). MATCHES ADRs D3, D4, D5.

### T2.1 — secure-by-default `createWebFetchTool` + barrel + docs → commit f7f67d0

- **Files declared vs changed:** declared web-fetch.ts, index.ts,
  web-fetch.test.ts, docs.md, `packages/sdk/CHANGELOG.md (root)`,
  `.changeset/m3-ssrf-guard.md`. All present. **Plus one undeclared file:**
  network-guard.ts (5-line IPv6-bracket-strip) — see F-xval-1 (MEDIUM).
  CHANGELOG location nuance — see F-xval-2 (LOW).
- **Acceptance Criteria (4):**
  - [x] `vitest run tests/web-fetch.test.ts` all pass (existing + 6 new) — 11/11.
  - [x] `test_web_fetch_blocks_metadata_ip` passes — `169.254.169.254` →
    `ssrf_blocked` (web-fetch.test.ts:56-61). The headline fix.
  - [x] `test_web_fetch_allowPrivateHosts_opt_out` passes — opt-out reaches fetch,
    returns non-`ssrf_blocked` error (web-fetch.test.ts:68-75). ADR D2.
  - [x] barrel exports — `test_network_guard_symbols_exported` imports all four
    from `../src/index.js` and asserts defined (web-fetch.test.ts:77-82); index.ts:32-39
    re-exports `isBlockedIp`/`resolveAndScreen`/`screenedFetch`/`SsrfBlockedError`.
    (Plan offered a built-dist `node -e` check OR a source-level import assertion;
    the source-level assertion path was taken — explicitly allowed by the AC "OR".)
  - [x] docs.md SSRF note (`grep ssrf` ≥ 1) + `.changeset/m3-ssrf-guard.md` exists
    + CHANGELOG `ssrf` ≥ 1 — all verified (docs.md:1900-1906; changeset present,
    targets `@theokit/sdk-tools` minor; root CHANGELOG.md:21).
  - [x] biome clean on changed files — verified.
- **DoD:** web-fetch tests green; typecheck exit 0; docs/changeset/CHANGELOG present.
  Build not re-run here (typecheck + full suite green is sufficient evidence; the
  implement-validate log records `build` PASS). ✓
- **D2/D6 detail:** guard ON by default in `createWebFetchTool`
  (web-fetch.ts:36 `allowPrivateHosts = opts?.allowPrivateHosts ?? false`); blocked
  → `{ ok:false, error:"ssrf_blocked", reason }` (web-fetch.ts:117-119) — error
  return, does NOT throw to the model. Guard lives in
  `sdk-tools/src/internal/network-guard.ts`, exported from the sdk-tools barrel
  (index.ts). MATCHES ADRs D2, D6.

## ADR compliance (all 6 honored)

| ADR | Decision | Evidence | Verdict |
|---|---|---|---|
| D1 | pure `isBlockedIp` block-list + `SsrfBlockedError extends ConfigurationError` code `ssrf_blocked` | network-guard.ts:20-28, 98-107; pure, no I/O; code valid per errors.ts:205 | RESPECTED |
| D2 | secure-by-default + `allowPrivateHosts` opt-out | web-fetch.ts:36, 77-80; `{ok:false,error:"ssrf_blocked"}` return | RESPECTED |
| D3 | `redirect:"manual"` + per-hop re-screen | network-guard.ts:187-194; `grep -c 'redirect: "manual"'` = 3 | RESPECTED |
| D4 | screen-all + re-screen-hops; IP-pinning deferred | resolve-all (network-guard.ts:134-139) + per-hop (187-189); NO IP-pinning code, NOT claimed | RESPECTED |
| D5 | normalize/reject alternate encodings + non-http redirect rejected | DNS-resolve canonicalizes (decimal test passes); non-http throws (network-guard.ts:153-155) | RESPECTED |
| D6 | placement sdk-tools/internal/network-guard.ts + barrel export | file at declared path; index.ts:32-39 | RESPECTED |

## Coverage Matrix walk (8/8)

| # | Gap | Task | Status |
|---|---|---|---|
| 1 | No IP block-list | T1.1 | CLOSED — isBlockedIp canonical ranges + mapped unwrap |
| 2 | No DNS resolve-all | T1.2 | CLOSED — resolveAndScreen loops all addrs |
| 3 | Redirects unscreened | T1.2 | CLOSED — redirect:manual + per-hop |
| 4 | web_fetch unguarded | T2.1 | CLOSED — secure-by-default + opt-out |
| 5 | Typed error | T1.1 | CLOSED — SsrfBlockedError extends ConfigurationError |
| 6 | Zero new deps | T1.1/T1.2 | CLOSED — node dns/net only; no `dependencies` key |
| 7 | TOCTOU + encoding | T1.1/T1.2 | CLOSED — screen-all + re-screen-hops; resolve canonicalizes |
| 8 | Document + export | T2.1 | CLOSED — barrel + docs + changeset + CHANGELOG + tests |

## Findings

- id: F-xval-1
  severity: MEDIUM
  file: packages/sdk-tools/src/internal/network-guard.ts:122-128 (commit f7f67d0)
  plan_ref: T2.1 "Files to edit" (declares web-fetch.ts, index.ts, web-fetch.test.ts, docs.md, CHANGELOG, changeset — NOT network-guard.ts)
  summary: >
    T2.1 made an undeclared 5-line edit to network-guard.ts (renamed param
    host→rawHost and added IPv6 bracket-strip `rawHost.replace(/^\[|\]$/g, "")`).
    Scope creep relative to the plan's declared T2.1 file list.
  assessment: >
    Functionally CORRECT and NECESSARY — `new URL("http://[::1]/").hostname`
    returns "[::1]" with brackets, which `net.isIP` does not recognize; without
    the strip, `test_web_fetch_blocks_ipv6_loopback` (a T2.1 AC) would fail. This
    is a within-task corrective fix to a Phase-1 file, not unrelated drift. It is
    covered by the existing tests and biome-clean. Flagged for process honesty
    (plan file list was incomplete), not as a quality defect.
  recommended_action: >
    Accept as-is. Optionally note in the implementation summary that the IPv6
    bracket-strip was a T2.1-discovered correction to network-guard.ts. No revert
    needed; no ADR needed (behavior matches D5 normalization intent).

- id: F-xval-2
  severity: LOW
  file: CHANGELOG.md:21 (root) vs plan T2.1 "packages/sdk/CHANGELOG.md (root)"
  plan_ref: T2.1 Files to edit — "packages/sdk/CHANGELOG.md (root)"
  summary: >
    The plan's file label "packages/sdk/CHANGELOG.md (root)" is ambiguous; the
    SSRF entry landed in the workspace-root CHANGELOG.md (correct per the SDK's
    CHANGELOG discipline: workspace-level changes go to root CHANGELOG.md). The
    changeset correctly targets `@theokit/sdk-tools` (minor). packages/sdk/CHANGELOG.md
    was not touched (correct — this is an sdk-tools change, not an sdk change).
  recommended_action: >
    No action. The placement is correct (root CHANGELOG + sdk-tools changeset);
    the plan label was just imprecise. AC grep ("ssrf" in a CHANGELOG ≥ 1) is met.

- id: F-xval-3
  severity: INFO
  file: packages/sdk-tools/tests/network-guard.test.ts
  plan_ref: T1.2 AC "22/22 (11 from T1.1 + 11 here)" vs TDD block listing 11 named RED tests
  summary: >
    T1.2 implements 11 new tests (6 resolveAndScreen + 5 screenedFetch) matching
    the 11 named tests in the plan TDD block, totaling 22 with T1.1. The "+11"
    reconciles exactly. No false claim.
  recommended_action: None.

- id: F-xval-4
  severity: INFO
  file: .claude/knowledge-base/plans/m3-ssrf-guard-plan.md (git)
  plan_ref: Step G — plan drift
  summary: >
    Plan committed 20:02:33; implement (06e7b1c) started 20:05:38. Plan frozen
    before implement; no edit after start. Contract intact.
  recommended_action: None.
