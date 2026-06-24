---
"@theokit/sdk": minor
---

V3-3 — add a **token-budget mode** + **configurable marker** + **template-driven summarizer** + **opt-in fail-safe** to `@theokit/sdk/compaction`, reaching behavioral parity with theocode's compaction so it can adopt the SDK helper. All additive and default-preserving — no existing `keepRecent` caller, persisted `[[theokit:checkpoint]]` marker, or propagate-on-throw contract changes.

- `compactTranscript(messages, { keepTokens?, marker?, summaryTemplate?, failSafe?, … })`:
  - `keepTokens` selects the recent window by accumulated `estimateTokens` (theocode `splitTranscript` semantics; always keeps ≥ 1 turn). Takes precedence over `keepRecent`; in this mode leading system prompts are not specially preserved.
  - `marker` (default `CHECKPOINT_MARKER`, must be non-empty) lets a consumer use a custom checkpoint sentinel such as a persisted `<conversation-checkpoint>`.
  - `summarize(older, template)` now receives the summary `template`; `SUMMARY_TEMPLATE` (a 7-section template — Goal/Constraints/Progress/Decisions/Next/Critical/Files) is exported and overridable via `summaryTemplate`.
  - `failSafe: true` returns the ORIGINAL transcript + a structured warn when the summarizer throws (default still propagates).
- `filterFromLatestCheckpoint(messages, { marker?, include? })` — `include: "from"` returns the turns from the latest checkpoint inclusive (default `"after"` unchanged).
- `buildCheckpoint(label?, marker?)` — accepts a custom marker (empty marker throws).

Zero new dependency (token-budget reuses the in-module `estimateTokens`).
