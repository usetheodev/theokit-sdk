---
"@theokit/sdk": minor
---

A silent LLM token undercount is now observable (#66). When a provider omits `usage` on a finish, the SDK used to coerce the counts to `0` (`?? 0`), so budget consumption was under-reported without any signal. The loop now distinguishes "provider omitted usage" from "0 tokens used": it emits a `theokit_llm_usage_missing` metric and a stderr WARN so the gap is visible, instead of silently zeroing. Normal finishes emit the token throughput as a `theokit_llm_tokens` metric. No new dependency (no local tokenizer — the fix makes the silent gap loud + measurable rather than estimating). Also documents the artifacts scope decision (cloud-only/pre-release; a local ArtifactService is deferred) in docs.md.
