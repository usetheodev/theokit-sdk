---
"@theokit/sdk": minor
---

M2-2 — pre-call token estimate + compaction decision (plan `m2-token-estimate`).

Two pure, zero-dependency helpers on the `@theokit/sdk/compaction` subpath (siblings of `compactTranscript`/`isContextOverflowError`):

- `estimateTokens(text)` — a tokenizer-free token estimate via the ~4-chars-per-token heuristic (`ceil(text.length / 4)`): `""` → 0, any non-empty text → ≥ 1. A cheap PRE-CALL gate, not exact tokenization.
- `shouldCompact({ estimated, contextWindow, buffer })` — decide BEFORE sending whether to compact: `true` when `estimated >= contextWindow - buffer`. Pure; the caller supplies the window (e.g. from `resolveModelCapabilities`), keeping it decoupled from any per-model catalog.

No tokenizer dependency.
