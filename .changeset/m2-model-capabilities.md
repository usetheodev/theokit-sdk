---
"@theokit/sdk": minor
---

M2-4 — per-model capability catalog public + OpenRouter slug-suffix fix (plan `m2-model-capabilities`).

- **New `@theokit/sdk/models` subpath.** `resolveModelCapabilities(modelId): ModelCapabilities` (previously dead `@internal`) is now public — returns a model's capability flags + `maxContextTokens`/`maxOutputTokens` from a static, OFFLINE catalog (pure, sync, no network). Pair `maxContextTokens` with `@theokit/sdk/compaction`'s `shouldCompact`.
- **Fix:** OpenRouter `:variant` suffixes (`:free`/`:nitro`/`:floor`/`:beta`) were not stripped before the catalog lookup, so `openrouter/openai/gpt-4o:free` fell back to conservative defaults (4096) instead of the real 128k window. The suffix is now stripped (alongside the existing routing-prefix strip); unknown models still get conservative defaults.

Zero new dependencies.
