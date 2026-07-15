# Review — SE41 Pluggable SessionStore seam

**Date:** 2026-07-15
**Slug:** pluggable-session-store · **Milestone:** SE41
**Branch reviewed:** `worktree-agent-a670194799635578f` (`c4d410c9` → HEAD), 5 SE41 commits ahead of `develop`.
**Verdict:** READY_TO_MERGE

## Method

Two independent read-only specialist agents reviewed the `develop...HEAD` diff:
1. **Architecture + wiring** — traced the seam from the public `Agent` path to `store.readRecords`/`appendRecords`.
2. **Cross-validation + test-quality** — DoD ↔ impl ↔ tests, no-stubs, docs/ADR/changeset.

## Consolidated result

Both agents: **READY_TO_MERGE. Zero BLOCKER/HIGH/MEDIUM.** DoD 5/5 PASS.

- Interface is exactly 2 methods over native `SessionRecord` (not the removed ~10-method adapter); reaches the public barrel.
- `FsSessionStore` default: true append under the file lock (mkdir-before-lock preserved); missing session → `[]`.
- Wiring end-to-end: `LocalOptions.sessionStore` → resolved at the LocalAgent composition root → threaded through `hydrateSession` (read) + `persistTurnToTranscript`/`runPostRunLifecycle` (append) + compaction. No orphan bypass.
- Byte-identical default: SE40 golden persistence/resume/compaction suite migrated to route through `FsSessionStore`, native-shape assertions intact (34/34 + full suite 3497/0).
- Error handling: `readRecords` throw on resume propagates (fail-fast), covered by a negative-case test.
- Real-LLM: env-gated OpenRouter test recalls a planted codeword across a simulated cold start from the external store — `real-llm-validation` satisfied.
- no-stubs-no-mocks-no-wired: `FsSessionStore` + the example's `MapSessionStore` are real impls; `SessionStore` is a public interface with a shipped default (allowed).
- docs.md `SessionStore` section + config row; ADR D432 (with 3 alternatives); minor changeset — all present.
- Honesty: cross-host consistency correctly scoped to the external store's documented contract; no overclaim.

## Findings and resolution

| Sev | Finding | Resolution |
|---|---|---|
| LOW | Write path is best-effort (append failure logged to stderr, not thrown) — external-store authors should know. | Documented in the `SessionStore.appendRecords` JSDoc (best-effort write; read must throw). |
| INFO | Golden "byte-identical" proof is the migrated SE40 suite, not a net-new file. | Accepted — equivalent proof (same expected values + on-disk `.jsonl` assertions through the default store). |
| LOW (process) | No `knowledge-base/plans/pluggable-session-store-plan.md` in the pipeline path expected by cross-val. | A plan WAS written for this slice; the reviewer's worktree checkout predated it. The ROADMAP SE41 DoD (authoritative) is fully satisfied. |

## Evidence

typecheck 22/22 · biome clean (1467 files) · full suite **3497 passed / 0 failed / 39 skipped** · `quality:cycles` 3/3 (no new cycle) · knip clean · real-LLM external-store cold-start recall green on OpenRouter.
