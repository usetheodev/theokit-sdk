# Review — leaked-dialect-safe-parse (theokit#58 follow-up)

**Date:** 2026-06-30
**Cycle:** REVIEW (independent fresh-eyes pass per `rules/cycle-review.md`)
**Package:** `@theokit/sdk`
**Branch:** `develop` (uncommitted working tree)
**Verdict:** READY_TO_MERGE

## Scope

Opt-in recovery of the Hermes tool-call dialect (`<function=NAME><parameter=KEY>VALUE</parameter></function></tool_call>`)
leaked as assistant TEXT by some OpenAI-compatible models (qwen3-coder via OpenRouter). With zero native
`tool_calls` the agent loop saw `end_turn` and the intended call was silently lost. Layer ownership (DISCOVER):
the `@theokit/agents` bridge is display-only and cannot make a leaked call execute — the fix belongs in the SDK
provider/response layer that owns the loop + tool dispatch.

## Files

| File | Change |
|---|---|
| `packages/sdk/src/internal/llm/hermes-tool-extract.ts` | NEW — pure `extractHermesToolCalls(content, makeId)`; fail-open; mirrors `strip-think` (`matchAll`). |
| `packages/sdk/src/internal/llm/openai.ts` | `OpenAIClientOptions.extractToolCallsFromContent`; accumulator constructor `(flag, providerName)`; `finish()` recovery branch (guarded by `toolCalls.length === 0`), `stopReason → tool_use`, stderr observability line. |
| `packages/sdk/src/internal/llm/router.ts` | `selectTransport` copies `profile.extractToolCallsFromContent` to client options. |
| `packages/sdk/src/internal/providers/types.ts` | `ProviderProfile.extractToolCallsFromContent?: boolean` (public). |
| `packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts` | NEW — 10 unit tests (helper + accumulator). |
| `packages/sdk/tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` | NEW — 5 end-to-end SSE tests through `OpenAIClient.stream`. |
| `docs.md` | ProviderProfile field documented (public surface). |
| `.changeset/leaked-dialect-safe-parse.md` | `@theokit/sdk: minor`. |

## Findings (independent reviewer)

- **BLOCKER / HIGH / MEDIUM:** none.
- **LOW (all 3 addressed in this cycle):**
  1. `crypto.randomUUID()` bare global deviated from codebase precedent → switched to `globalThis.crypto.randomUUID()`.
  2. No observability when recovery fires (wiring-triad pillar c) → added a one-line stderr log
     (`[theokit-sdk] recovered N leaked tool call(s) … provider=… names=…`).
  3. Recovered param values are raw strings (text dialect carries no types) → documented in the extractor doc-comment
     (downstream schema coerces; fails clear, never silent).
- **INFO (follow-up candidates, not defects):** recovery tied to the `</tool_call>` sentinel (a `</function>`-only
  variant would be missed — matches the documented #58 dialect); no built-in profile enables the flag (ships dormant
  by design — consumer opts in via a profile variant); `name.length === 0` guard effectively unreachable (cheap defense).

## Evidence (100% functional)

- **Wiring triad reachable end-to-end:** `ProviderProfile.extractToolCallsFromContent` → `router.selectTransport`
  → `OpenAIClientOptions` → `OpenAIStreamAccumulator` → `finish()`. Confirmed by reviewer reading each hop.
- **Loop dispatch:** `loop.ts` gate `stopReason !== "tool_use" || toolCalls.length === 0` → recovery flips both,
  control reaches `dispatchTools`. The recovered call genuinely executes.
- **Dedup:** native `tool_calls` pushed before the `length === 0` guard ⇒ native always wins (unit + golden proof).
- **Default-off path unchanged:** flag-off unit + golden tests assert the exact prior bug-state.
- **Tests:** 15/15 new (10 unit + 5 golden) pass. Full LLM+golden suite 182/182. **Full SDK package suite: 2970 passed, 36 skipped, 0 failures.**
- **Static:** `tsc --noEmit` 0 errors (strict `noUncheckedIndexedAccess` guarded); `biome check` clean on all 6 changed files.

## Next steps (human-gated)

- Commit on `develop` (awaiting user go — no `Co-Authored-By` trailer per SDK policy).
- Release `@theokit/sdk` via changesets (needs npm token + human PR approval — Unbreakable Rule 4).
- After release: bump `@theokit/agents`/`theokit` to consume the new SDK; a qwen3-coder ProviderProfile variant must
  set `extractToolCallsFromContent: true` for the route to benefit (adoption/enablement step).
