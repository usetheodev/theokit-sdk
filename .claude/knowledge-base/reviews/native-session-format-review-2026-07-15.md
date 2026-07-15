# Review — SE40 native session format (v4.0)

**Date:** 2026-07-15
**Slug:** native-session-format
**Branch reviewed:** SE40 integration (`e640c4c8` → `5ea704a8`), now fast-forwarded onto `develop`.
**Verdict:** READY_TO_MERGE

## Method

Three independent read-only specialist agents reviewed the migration diff (`develop...HEAD`, 58 src+test files, ~785 add / ~4949 del) in an isolated worktree:

1. **Architecture + wiring** — traced the native write/read/compaction path end-to-end.
2. **Cross-validation** — plan DoD ↔ implementation ↔ tests ↔ docs consistency; removal completeness.
3. **Test-auditor** — did the ~12 deleted test suites leave any still-live behavior uncovered?

## Consolidated findings and resolution

| Sev | Finding | Resolution |
|---|---|---|
| HIGH | `local.baseDir: "~/.claude"` not tilde-expanded → wrote to literal `./~/.claude`, breaking the CLI `--continue` interop | Added `expandTilde()`; applied in `resolveBaseDir`; unit-tested. Commit `5ea704a8`. |
| HIGH | T6 acceptance (real `claude-code-log` round-trip + real-LLM `--continue`) deleted with the SE39 writer; `validate_claude_code_jsonl.py` orphaned | Re-homed onto the native format: `native-transcript-roundtrip.test.ts` (real parser) + `real-llm/native-transcript-real.test.ts` (OpenRouter write→read→`--continue`, BANANA recall). Both green. Commit `5ea704a8`. |
| MEDIUM | `compactSession` orphaned dead code with a false docstring | Deleted (append-only boundary already covered by `appendCompactBoundaryRecord`). |
| MEDIUM | `docs.md` `AgentOptions.local` type row omitted `baseDir` | Added `baseDir?: string` to the row. |
| LOW | Turn-count compaction docstring said "grew past the soft cap"; `session-types.ts` named deleted files | Corrected both. |

No BLOCKER findings. Removals (adapter contract, SE4 session metadata, SE33 durable objectives, `buildReplayHistory`, SE39 writer) verified complete: files deleted, barrels clean, `AgentOptions` fields removed, `grep` of `src/` clean, typecheck passes, `docs.md`/`CHANGELOG` updated.

## Evidence

- `typecheck` 22/22; `biome` clean (1461 files); full suite **3487 passed / 0 failed / 37 skipped** (independent clean run, no cache).
- Native transcript round-trips through the **real** `claude-code-log` Pydantic parser (`OK … 2 tool pairs`).
- Real-LLM `--continue` validated on OpenRouter (`openai/gpt-4o-mini`): a resumed agent recalled the codeword across a simulated restart; follow-up appended to the same transcript. Satisfies `rules/real-llm-validation.md`.
