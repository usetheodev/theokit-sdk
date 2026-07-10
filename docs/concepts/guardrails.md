# Guardrails

Guardrails inspect, transform, or block a message before it reaches the model
(input) or before the model's response reaches the caller (output). `@theokit/sdk`
ships the **pipeline** and the **deterministic** processors; the **LLM-classifier**
processors (moderation, PII, prompt-injection, language, prompt-scrubber) are
**delegated** to you — built on the same seam (see [ADR 0009](../adr/0009-delegate-llm-classifier-processors.md)).

## The seam (SE24)

`AgentOptions.inputProcessors` and `outputProcessors` are ordered arrays of
`Processor`:

```ts
interface Processor {
  id: string;
  processInput?(ctx): string | void; // rewrite the user message, or ctx.abort() / ctx.warn()
  processOutput?(ctx): string | void; // redact the model text, or ctx.abort() / ctx.warn()
  onViolation?(v: ProcessorViolation): void; // fires on abort() AND warn()
}
```

- Return a string to **rewrite / redact**; return nothing to pass through.
- `ctx.abort(reason)` **blocks** the run — it stops with `RunResult.tripwire`
  (`{ reason, processorId }`) and a `tripwire` run-event via `SendOptions.onRunEvent`.
  An input block never reaches the model.
- `ctx.warn(message, detail?)` reports a **non-blocking** violation (fires
  `onViolation`) and continues.

There is no `strategy` enum in core — the pattern IS the primitives: `abort()` to
block, return a string to rewrite/redact, `warn()` to detect without blocking.

## Shipped in core (deterministic, no LLM — SE25)

```ts
import { Agent, createUnicodeNormalizer, createTokenLimiter } from "@theokit/sdk";

const agent = await Agent.create({
  model: { id: "openai/gpt-4o-mini" },
  inputProcessors: [
    createUnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }),
    createTokenLimiter({ limit: 4000, strategy: "block" }), // cap the prompt
  ],
  outputProcessors: [
    createTokenLimiter({ limit: 2000 }), // truncate an over-long response
  ],
});
```

- `createUnicodeNormalizer` — NFC-normalize + optional control-char strip + whitespace collapse.
- `createTokenLimiter` — char-based estimate (`estimateTokens`, ~chars/4, NOT a per-model tokenizer); `truncate` (default) or `block`.

## Delegated (LLM-classifier — you build these on the seam)

Moderation, PII detection, prompt-injection detection, language detection, and
system-prompt scrubbing all need a **classifier** (an external API or a model) with
categories + thresholds that change frequently. Core does not ship them (ADR 0009);
you wire your chosen classifier onto the seam.

### Moderation (block on a category hit)

```ts
import type { Processor } from "@theokit/sdk";

// `classify` is YOUR classifier — an external moderation API, a small local model,
// or another agent. It returns per-category scores in [0, 1].
function moderationProcessor(
  classify: (text: string) => Promise<Record<string, number>>,
  opts: { threshold: number; categories: string[] },
): Processor {
  return {
    id: "moderation",
    async processInput(ctx) {
      const scores = await classify(ctx.message);
      const hit = opts.categories.find((c) => (scores[c] ?? 0) >= opts.threshold);
      if (hit !== undefined) ctx.abort(`moderation: ${hit} >= ${opts.threshold}`);
      return ctx.message; // reached only on a pass — abort() throws
    },
    onViolation: (v) => console.log(JSON.stringify(v)), // wire your logger / alerting here
  };
}
```

### PII redaction (rewrite, do not block)

```ts
function piiRedactor(
  detect: (text: string) => Promise<Array<{ start: number; end: number }>>,
): Processor {
  return {
    id: "pii-redactor",
    async processOutput(ctx) {
      const spans = await detect(ctx.text);
      if (spans.length === 0) return ctx.text;
      let out = ctx.text;
      for (const s of spans.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, s.start) + "[REDACTED]" + out.slice(s.end);
      }
      ctx.warn("pii-redacted", { count: spans.length }); // non-blocking signal
      return out;
    },
  };
}
```

Wire them like any processor: `inputProcessors: [moderationProcessor(myApi.classify, { threshold: 0.7, categories: ["hate", "violence"] })]`.

### Recommended classifiers

Pick per your latency / privacy / cost needs — the seam is agnostic:

- **Hosted moderation APIs** — OpenAI Moderation, Azure Content Safety, Google
  Perspective (fast, no infra; data leaves your boundary).
- **PII** — Microsoft Presidio (self-hosted, no data egress), or a cloud DLP API.
- **Prompt-injection** — a small classifier model (e.g. an `-guard` model) called
  via a provider, or a rules+model hybrid.
- **A TheoKit agent as the classifier** — a one-shot `Agent.prompt(text, { model, apiKey })`
  (static), or a stateful judge agent via `(await agent.send(text)).wait()`, inside your processor.

## Handling a blocked run

```ts
const run = await agent.send(userInput, { onRunEvent: (e) => {
  if (e.type === "tripwire") console.error(`blocked by ${e.processorId}: ${e.reason}`);
}});
const result = await run.wait();
if (result.tripwire) {
  // status is "cancelled"; result.result is undefined on an input block.
  // On an OUTPUT block the model already ran, so usage/cost survive (billing).
}
```

## See also

- [ADR 0008](../adr/0008-guardrail-processor-pipeline-seam.md) — why the pipeline is
  first-class, tripwire shape, cloud serialization.
- [ADR 0009](../adr/0009-delegate-llm-classifier-processors.md) — why classifiers are
  delegated + the re-evaluation triggers.
- [`examples/guardrails/`](../../examples/guardrails/) — a runnable moderation +
  PII-redaction example over a pluggable classifier.
