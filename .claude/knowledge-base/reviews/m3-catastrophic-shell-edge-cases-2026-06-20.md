# Edge Case Review — m3-catastrophic-shell (PLAN cycle)

Date: 2026-06-20
Plan analyzed: knowledge-base/plans/m3-catastrophic-shell-plan.md
Tasks analyzed: 2 (T1.1 guardrail primitive, T2.1 wiring)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

> Supersedes the discover-cycle edge-case review (EC-1 chaining/sudo + EC-2 curl|sh — absorbed into ADR D3 + T1.1 TDD). Plan-scoped review for `/plan-confidence`.

## Boundary map

`catastrophicShellReason` is a pure string analyzer (no I/O). Live edge family: parsing correctness (segment splitting vs fork-bomb internal pipes; rm target normalization). The screen runs before spawn → fails closed for the catastrophic set.

## MUST FIX

(none — pure function, fails-closed-before-spawn; the deny-list is a documented guardrail; chaining/sudo/pipe-to-shell absorbed into ADR D3 + the T1.1 TDD list.)

## SHOULD TEST

### EC-1: fork bomb contains internal pipes — must match whole-command, not be lost in segment splitting
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `:(){ :|:& };:` contains `|` and `;` — naive segment splitting would shred it. The fork-bomb detector must match the whole-command shape (a function defining `:` that pipes to itself), independent of the generic segment split used for the other patterns.
- **Suggested test:** `test_blocks_fork_bomb` (already in T1.1) + ensure the implementation runs the fork-bomb regex on the RAW command before/besides segment splitting. Pin: `:(){ :|:& };:` → reason even though it has `|`/`;`.

### EC-2: `rm -rf` target normalization (`/`, `//`, `/.`, `/ `, glob)
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** `rm -rf //`, `rm -rf / `, `rm -rf /.` , `rm -rf /*` must all be caught; `rm -rf ./build/` allowed.
- **Suggested test:** `test_blocks_rm_rf_root_variants` — `rm -rf //`, `rm -rf /*`, `rm -rf "/"` → reason; keep `test_allows_rm_rf_relative` for `./build`.

## DOCUMENT

### EC-3: empty / whitespace-only / comment-only command
- **Accepted risk:** `catastrophicShellReason("")` / `"   "` / `"# comment"` → `null` (nothing catastrophic to run). Safe default; documented. No action.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 3 | 0 | EC-1, EC-2 | EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — fork-bomb-whole-match + rm-target-variants — fold into T1.1 TDD; no MUST FIX)
