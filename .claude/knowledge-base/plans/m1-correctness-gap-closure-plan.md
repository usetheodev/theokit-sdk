---
slug: m1-correctness-gap-closure
milestone_id: M1
created_at: 2026-07-14
goal: Close the genuine gaps adversarial review found in the shipped M1 fixes (#58/#55/#65/#57); #57 verified FULLY_CLOSED.
---

# Plan — M1 correctness core gap closure

Same pattern as M0: fixes were shipped, checkboxes left `[ ]`. Adversarial review (3 agents)
found real residual gaps. Closed only genuine defects (TDD); documented design boundaries.

| # | Finding | Severity | Task |
|---|---|---|---|
| #58-a | `JobQueue.cancel()` of a running non-cooperative job leaks its slot → bounded queue deadlocks | MEDIUM | T1 (release-on-cancel + idempotent #release) |
| #58-b | between-iteration cancel reports `finished`, not `cancelled` | LOW-MED | T2 (set finalStatus="cancelled") |
| #55-a | delegated subagents don't inherit parent plugins → child tool calls escape arg-level permission gate | HIGH | T3 (propagate plugins into child Agent.create) |
| #65-a | `transform_llm_output` only rewrites tool-turn history, never final user-visible text; skips text-only turns | LOW-MED | T4 (apply once up-front) |
| #57 | tool-result guard — FULLY_CLOSED (opt-in, origin-agnostic, replaces LLM-visible content, fail-closed) | — | verify + flip |

Design boundaries (documented, not fixed): #55 nested-arg matching (use predicate form), first-match
precedence (not deny-wins), throwing predicate fail-closes by aborting the run; #57 image/non-text
blocks intentionally not scrubbed.

## DoD
- [x] T1 JobQueue deadlock fixed + no-double-free test.
- [x] T2 cancelled status emitted + test.
- [x] T3 subagent inherits parent plugins + wiring test.
- [x] T4 transform_llm_output rewrites final text + test.
- [ ] full suite + typecheck + biome green; ROADMAP M1 flipped; changesets.
