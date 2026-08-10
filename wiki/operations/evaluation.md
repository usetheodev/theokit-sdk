---
type: Practice
title: Evaluation
description: Datasets and scorers that measure behavior rather than surface, the CI gate, the documented biases of LLM-as-judge, and the test pyramid applied to agents.
tags: [evaluation, testing, ci, quality, judge]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 10, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 10 — evaluation
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: eval
    resource: packages/sdk/src/eval (public sub-entry @theokit/sdk/eval)
    title: Eval, Scorers and assertEval — verified at @theokit/sdk@4.36.0 on 2026-07-30
  - id: testing-rule
    resource: .claude/rules/testing.md
    title: Project testing rule — edge cases vs negative cases
---

# The thesis

> **Without evaluation you do not have an AI system. You have a demo that got lucky.**

The reason is structural: the central component is stochastic. Without a baseline no change
is demonstrably an improvement, and "I improved the prompt" is a claim with no epistemic
value. This is the project's own testing rule applied one level up: *code without tests is
code that works by coincidence* — and with an LLM in the middle, the coincidence gets both
more likely and more convincing.[^testing-rule]

# The basic path

```typescript
import { Eval, Scorers, assertEval, type EvalRun } from "@theokit/sdk/eval";

const run: EvalRun = await Eval.create({
  name: "support-qa",
  dataset: [
    { input: "How do I cancel my subscription?", expected: "cancel" },
    { input: "What is the status of order ORD-1?", expected: "ORD-1" },
  ],
  scorers: [
    Scorers.containsExpected({ caseSensitive: false }),
    Scorers.levenshtein({ threshold: 0.8 }),
  ],
  agent: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
  },
  concurrency: 2,
  trials: 3, // repetition: measures variance, not just the mean
}).run();

console.log(run.aggregate.meanScore, run.aggregate.passRatio, run.aggregate.errorRows);

// CI gate — throws EvalThresholdError listing EVERY unmet threshold.
assertEval(run, {
  minMeanScore: 0.8,
  minPassRatio: 0.9,
  maxErrorRatio: 0,
  perScorer: { "levenshtein(>=0.8)": 0.7 },
});
```

**`trials: 3` is not a luxury.** One execution per row measures luck. Three measure tendency
and reveal variance — and high variance is a *product* result, not academic statistics: it
means different users will see different quality.

# Choosing the scorer

Available scorers: `exactMatch`, `containsExpected`, `regex`, `jsonShape` (Zod), `llmJudge`,
`verifyGate`, `levenshtein`, `numericDiff`, `embeddingSimilarity`.

| Output type | Scorer | Do not use |
| --- | --- | --- |
| Enum / closed class | `exactMatch` | `llmJudge` (expensive and worse) |
| Must contain a fact | `containsExpected` | `exactMatch` (brittle) |
| Structured format | `jsonShape` | regex |
| Numeric with tolerance | `numericDiff` | `exactMatch` |
| Nearly identical text | `levenshtein` | `exactMatch` |
| Semantically equivalent | `embeddingSimilarity` | `levenshtein` |
| Subjective quality | `llmJudge` | anything deterministic |
| "Did it pass the tests?" | `verifyGate` | `llmJudge` |

**Preference hierarchy: deterministic > embedding > LLM judge.** Every step to the right costs
more and measures worse. Starting at `llmJudge` spends 10× to measure with more noise.

# LLM-as-judge, with its biases

Documented biases you must control:

* **position** — the judge favors the first (or last) option shown;
* **verbosity** — long answers look better;
* **self-preference** — a model tends to prefer its own output;
* **self-rationalization** — the judge decides and then invents the justification, which is
  why "the explanation looked good" validates nothing.

Practical mitigations: an explicit rubric instead of "rate the quality"; alternate the order;
use a judge from a different family than the one being judged; and **calibrate against human
labels** on a subset — if the judge does not agree with humans on 50 examples, it is not
measuring what you think it is.

The SDK also offers judge-based completion checking (`SendOptions.completionCheck` →
`RunResult.completionCheck`) with a design detail worth copying: when the judge's output
cannot be parsed, the result is `parseFailed: true` and `complete: false`. **Fail-safe: an
unreadable judge does not approve.**

That property is load-bearing in a [closed autonomous loop](/concepts/control-cadence.md),
where the judge is the only witness.

# The test pyramid applied to agents

```
        /  E2E with a real LLM  \      few; expensive, slow, non-deterministic
       /-------------------------\
      /  Eval with a dataset      \    moderate; this is where quality lives
     /-----------------------------\
    /  Unit tests without an LLM    \  MANY; fast and deterministic
   /---------------------------------\
```

The base is wider than intuition suggests, because **a great deal of an agent is testable
without an LLM**: permission policy, context policy, error mapping, failure classification,
`toModelOutput`, schema validation, budgeting, path safety. If your suite needs an API key to
run, you built an inverted pyramid — and you will feel it on every PR.

A dataset is honest when it has all three kinds: happy path, **negative cases** (invalid or
hostile input, expecting a typed error) and boundary cases. The distinction between edge and
negative is the project's testing rule: an unhandled edge produces a *wrong answer*; an
unhandled negative produces a *crash or a silent swallow*.

# Mastery criterion

You define the evaluation strategy for a new agent: what is tested without an LLM, what goes
into the eval, what the CI gate is, and how the judge is calibrated.[^course]

[^course]: Agent AI course, Module 10
[^testing-rule]: `.claude/rules/testing.md`
