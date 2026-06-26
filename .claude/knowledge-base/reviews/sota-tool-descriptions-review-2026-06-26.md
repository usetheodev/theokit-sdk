# Review — SOTA default descriptions for the 9 built-in sdk-tools

**Date:** 2026-06-26 · **Slug:** sota-tool-descriptions · **Commits:** bd10da3 (descriptions) · 8808906 (LOW fixes)
**Reviewer:** 1 adversarial (drift-focused). **Verdict: READY_TO_MERGE**

## Gates
- `pnpm --filter @theokit/sdk-tools test` **371 passed (29 files)**; `typecheck` 0; `biome check` clean.
- plan-confidence **SHIPPABLE 95.2**.

## What shipped
The 9 built-in tools' default `description` strings upgraded from terse to SOTA, behavior-accurate ACI copy — verified against each handler so the description lives next to the code it describes and cannot drift. Generalized (no app-specific cross-refs). No factory-signature change.

## Adversarial verification (per-tool: claim → handler)
All 9 VERIFIED. Highest-risk claims confirmed in code:
- **search_text** LITERAL + CASE-SENSITIVE — `line.includes(query)` with NO `toLowerCase` (search-text.ts:199).
- **web_fetch** SSRF-guarded — `screenedFetch(allowPrivateHosts: false default)` → `error:"ssrf_blocked"` (web-fetch.ts:36,119); makes no redirect claim.
- read_file whole-file/5MB; write_file OVERWRITES; edit_file FIRST/whitespace-fallback/.bak; glob `*`/`**`/excludes; shell 30000/300000/5MB; todolist actions; web_search title/url/snippet — all match handlers.
- `${maxMatches}` interpolation preserved; tests assert load-bearing phrases (not vacuous); no existing test broke; `docs.md` (the @theokit/sdk API contract) untouched + uncontradicted (it documents return shapes, not description prose); factory signatures unchanged.

## LOW findings — RESOLVED
- **LOW-1 (edit_file):** description said `old_string must differ from new_string` but the handler did not enforce it (no-op edit returned `replacements:1`). **Fixed (enforced, not softened):** handler returns `{ ok:false, error:"no_change" }` on `old===new` + TDD regression test. Description now matches behavior.
- **LOW-2 (web_search):** "if none is configured, returns no results" described consumer wiring (`search` is a required param), not the handler. **Fixed:** clause removed.
- **INFO:** stale per-file JSDoc return shapes (read-file/web-search) predate this work; the new descriptions are more accurate. Out of scope (separate cleanup).

## Decision
No BLOCKER/HIGH/MEDIUM; both LOWs remediated + re-validated (371 green). **READY_TO_MERGE.** This is the framework half of the user's thesis ("evolve the framework's descriptions, don't override app-side") — theocode's `TOOL_DESCRIPTIONS` override of the 9 framework tools can now be dropped (Part B).
