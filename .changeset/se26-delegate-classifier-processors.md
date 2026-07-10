---
"@theokit/sdk": patch
---

**SE26 — delegate LLM-classifier guardrail processors (ADR + recommendation + example).**

Records the decision (ADR 0009) to DELEGATE the LLM-classifier guardrail processors — moderation, PII, prompt-injection, language, prompt-scrubber — to specialist libraries / consumer code built ON the SE24 seam, rather than shipping concrete classifiers in `@theokit/sdk` core (mirrors the AUTH-DELEGATION lock: constant churn — provider/model deltas, taxonomies, thresholds, jailbreak patterns — vs a stable seam a single-maintainer core can own). No classifier is added to core.

Ships the paved path: `docs/concepts/guardrails.md` (how to build moderation / PII / injection processors on the seam + recommended external classifiers) and `examples/guardrails/` (a runnable moderation + PII-redaction example over a pluggable classifier). No public API change. From the a peer framework Guardrails comparison (SDK Evolution roadmap SE26).
