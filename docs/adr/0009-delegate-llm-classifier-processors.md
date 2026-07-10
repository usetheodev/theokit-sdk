# ADR 0009 — LLM-classifier guardrail processors are delegated, not shipped in core (SE26)

- **Status:** Accepted (2026-07-10)
- **Milestone:** SE26 (SDK Evolution — a peer framework Guardrails parity)
- **Relates:** ADR 0008 (SE24 — the `Processor` seam these build on), SE25 (deterministic in-tree processors), the AUTH-DELEGATION lock (roadmap "Architectural decisions on record")

## Context

a peer framework ships five LLM-classifier guardrail processors that call a model to judge
content: `ModerationProcessor` (hate/harassment/violence), `PIIDetector`,
`PromptInjectionDetector`, `LanguageDetector`, and `SystemPromptScrubber`. Each is
configured with a classifier model + thresholds + a taxonomy of detection categories.

SE24 shipped the `Processor` seam and SE25 shipped the deterministic, no-LLM
processors (Unicode normalize, token limit). The open question: does `@theokit/sdk`
core ship concrete LLM-classifier processors too?

## Decision

**Delegate the LLM-classifier processors to specialist libraries / consumer code
built ON the SE24 seam. Ship NO concrete classifier in `@theokit/sdk` core.** SE26
is a gated-decision milestone — it ships an ADR (this file), a recommendation page
(`docs/concepts/guardrails.md`), and a worked example (`examples/guardrails/`) — NOT
runtime code in core (same shape as SE5/SE6).

Rationale mirrors this repo's **AUTH-DELEGATION** lock:

- **Constant churn.** Classifier processors carry moving parts core cannot keep
  current: provider/model deltas, category taxonomies, threshold tuning, and
  evolving jailbreak/prompt-injection patterns. A single-maintainer core cannot
  track them; a stale moderation classifier is worse than none (false confidence).
- **The seam does not churn.** The SE24 `Processor` interface (`processInput` /
  `processOutput` / `abort` / `warn` / `onViolation`) is a stable, standards-level
  contract. A consumer wires ANY classifier onto it — an external moderation API, a
  local model, an SE24-seam processor over `agent.send` — without core involvement.
- **Provider-agnostic core.** Baking a classifier model choice into core would
  contradict the SDK's provider-agnostic posture (the same reason `@theokit/sdk`
  does not bundle auth providers).

## Consequences

- Core stays lean and churn-free: SE24 seam + SE25 deterministic processors only.
- Consumers get a **paved path**, not a shrug: `docs/concepts/guardrails.md` shows
  how to build moderation / PII / injection / language / prompt-scrubber processors
  on the seam, with recommended external classifiers, and `examples/guardrails/`
  ships a runnable moderation + PII-redaction processor over a pluggable classifier.
- No `Moderation` / `PII` / `Injection` runtime export is added to `@theokit/sdk`
  (verifiable: `grep` the public surface).

## Re-evaluation triggers (all required to reopen)

Mirrors AUTH-DELEGATION:

1. `@theokit/sdk` reaches a team of 3+ engineers committed to long-term maintenance.
2. Concrete demand from shipped TheoKit apps with measured pain — "I tried building a
   moderation processor on the seam and couldn't" reports > 5 / month.
3. A specialist classifier lib breaks compatibility with the SE24 seam without an
   actively maintained fix.
4. The recommended classifiers become abandoned/unmaintained with no viable
   alternative, leaving consumers without a paved path.

## If we ever adopt them

Ship as separate OPTIONAL packages under `@theokit/guardrail-*` (e.g.
`@theokit/guardrail-moderation`), each owning its provider/taxonomy deltas and
versioning independently — NEVER in `@theokit/sdk` core. Same containment as the
`@theokit/auth-*` plan in AUTH-DELEGATION.

## Alternatives considered

- **Ship one classifier "just for PII" in core.** Rejected: PII detection carries the
  same churn (locale-specific formats, evolving detectors) and would set the precedent
  the AUTH-DELEGATION lock exists to prevent. A one-off classifier in core is the exact
  trap.
- **Ship a `skill_search`-style built-in classifier tool.** Out of scope — that is a
  tool concern (bring-your-own-tools), not a guardrail-pipeline concern.
- **Do nothing (no docs, no example).** Rejected: "delegated" must not read as
  "unsupported". The recommendation page + worked example are the paved path that make
  delegation a real, followable choice.
