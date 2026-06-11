# Edge Case Review — theocode-phase5-tui

Date: 2026-06-11
Tasks analyzed: 9 (T5.1-T5.9)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## SHOULD TEST

### EC-1: Ink not installed — TUI import fails at runtime
- **Affected task:** T5.9
- **Suggested test:** `test_cli_graceful_error_without_ink()` — if `ink` or `react` is not installed (optional dep scenario), the CLI should print a human-readable error ("Missing dependency: ink. Run: pnpm add ink react") instead of a raw MODULE_NOT_FOUND stack trace.

### EC-2: Terminal too narrow for status bar
- **Affected task:** T5.6
- **Suggested test:** `test_status_bar_truncates_on_narrow_terminal()` — when `process.stdout.columns < 40`, status bar should truncate model name (e.g., "anthropic/claude-so..." instead of crashing on layout overflow).

## DOCUMENT

### EC-3: TUI tests use ink-testing-library which renders without a real terminal
- **Accepted risk:** Components tested via `ink-testing-library` render to strings, not actual ANSI terminal. Visual glitches (color bleeding, cursor positioning) won't be caught by tests. Acceptable because: (a) ink-testing-library is the official testing approach, (b) visual issues are cosmetic not functional, (c) manual QA on real terminals catches visual bugs before release.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 0 | 0 | 0 | 0 |
| T5.3 | 0 | 0 | 0 | 0 |
| T5.4 | 0 | 0 | 0 | 0 |
| T5.5 | 0 | 0 | 0 | 0 |
| T5.6 | 1 | 0 | 1 (EC-2) | 0 |
| T5.7 | 0 | 0 | 0 | 0 |
| T5.8 | 0 | 0 | 0 | 0 |
| T5.9 | 1 | 0 | 1 (EC-1) | 0 |
| All | 1 | 0 | 0 | 1 (EC-3) |

**Verdict:** PLAN OK — zero MUST FIX. The TUI plan is clean because it's pure UI with no I/O boundaries beyond terminal rendering (already abstracted by Ink).
