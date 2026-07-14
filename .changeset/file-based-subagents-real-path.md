---
"@theokit/sdk": patch
---

Fix: file-based subagents (`.theokit/agents/*.md`) now become delegation tools against a **real LLM**, not only in fixture mode. The real local-run path dropped `resolvedSubagents` — only the fixture path forwarded them — so a subagent defined on disk was never offered to the model and delegation silently fell back to `shell`. `buildRealRunOptions` now threads the merged subagents (file-based + inline, from `loadSubagents`) into the real run's tool assembly. Surfaced by running the new `examples/file-based` end-to-end against OpenRouter (the model now calls the `fact-checker` subagent tool). Regression-locked at the dispatch boundary.
