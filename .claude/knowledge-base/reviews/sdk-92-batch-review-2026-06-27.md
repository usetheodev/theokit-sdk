# Review — RADAR #92 framework batch (@theokit/sdk + sdk-tools + sdk-cache)

**Date:** 2026-06-27 · **Commit:** `ac3f77d`
**Reviewer:** independent verification (additive + backward-compat focus). **Verdict: READY_TO_MERGE**

## Gates
- `pnpm typecheck`: **22/22, 0 errors**.
- `pnpm test`: full suite green (sdk 2930 passed); 65 targeted tests across the 4 changes; RED→GREEN confirmed each.
- `pnpm run quality:dead` (knip): **clean** (every new export has a test/consumer).
- Biome + bundle-budget + attw: clean (pre-push gates passed).

## Changes (all additive, backward-compatible; one changeset: 3 packages minor)
- **#92.a `@theokit/sdk`** — `resolveModelCapabilities` catalog gains 9 slugs that previously fell to the 4096 default: 6 cheap OpenRouter (`qwen3-coder-30b-a3b-instruct`=160k, `deepseek-v4-flash`=1048576, `deepseek-v3.2`=131072, `glm-4.7-flash`=202752, `gemini-2.5-flash-lite`=1048576, `gemini-2.5-pro`=1048576) + `gpt-4.1`=1047576 + anthropic dot-forms (`claude-sonnet-4.5`/`claude-opus-4.1`/`claude-3.5-sonnet`=200k). No existing entry changed.
- **#92.d `@theokit/sdk-tools`** — `createGenericHttpSearchAdapter({ apiKey?, endpoint?, fetchImpl? })` → `WebSearchCallback` (env `THEOKIT_SEARCH_API_KEY`/`_URL`, `GET ?q&n` + Bearer, graceful-`[]` when unconfigured/on-error). Exported alongside `createBraveWebSearchAdapter`.
- **#92.b `@theokit/sdk-tools`** — `buildEnvContext(cwd, opts?: { now?, gitHeadPath? })`: adds a `Branch:` line via pure `.git/HEAD` read + injectable clock; all prior output preserved.
- **#92.e `@theokit/sdk-cache`** — `createLexicalEmbedder(dimension=256): CacheEmbedderRuntime` (token-hash freq vector, L2-normalized, zero-dep), exported + README'd.

## Adversarial verification
- **Additivity:** #92.a only adds Map entries (no existing window changed — `tsc` + full suite green). #92.d is a new file + barrel export (no existing adapter touched). #92.b widens `buildEnvContext` with an optional 2nd arg (existing `buildEnvContext(cwd)` calls unaffected; prior output kept, branch is an added line). #92.e is a new file + barrel export.
- **Honest decisions (flagged by the implementer):** `gpt-4.1` vision/structured set true (multimodal flagship — marking false would wrongly gate valid requests); anthropic dot-forms mirror their dash siblings (verified all 3 fell through to 4096 before). Reasonable + documented.
- **Promotions are faithful:** #92.d/#92.e copy theocode's proven algorithms (generic HTTP search; lexical token-hash embedder) with env names generalized to `THEOKIT_*`; #92.b borrows theocode's pure `.git/HEAD` read. The consumer source is the proof the primitives are real + generic.
- **Tests non-vacuous:** each change has RED→GREEN (slugs returned 4096 before; adapters/exports unresolved before); knip confirms no dead exports.

## Findings
- INFO (`gpt-4.1` capability flags): set vision/structured true — documented judgment call. Accepted.
- No BLOCKER/HIGH/MEDIUM.

## Decision
Four additive, backward-compatible framework promotions, faithful to the validated consumer algorithms, full suite + typecheck + knip + biome green. **READY_TO_MERGE.** On merge + publish (`@theokit/sdk` minor, `@theokit/sdk-tools` minor, `@theokit/sdk-cache` minor), theocode adopts: #92.a `resolveModelCapabilities` (drop MODEL_CONTEXT_WINDOW), #92.d `createGenericHttpSearchAdapter` (drop local web-search), #92.e `createLexicalEmbedder` (drop local cache-embedder), #92.b enriched `buildEnvContext` (drop local branch/clock; keep langs/cmds/readme local).
