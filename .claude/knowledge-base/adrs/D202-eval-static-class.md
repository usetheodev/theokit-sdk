# D202 — `Eval` is a static class with `Eval.create` factory + `.run()` method

**Date:** 2026-05-22
**Status:** Accepted

## Decision

The public eval surface ships as a static class on `@usetheo/sdk`:

```ts
const evalRun = await Eval.create({ name, dataset, scorers, agent }).run();
```

`Eval.create(opts)` validates `opts` via Zod and returns an `Eval` instance.
`instance.run(runOpts?)` returns `Promise<EvalRun>`. No intermediate iterator,
no streaming surface in v1 (deferred per Out-of-Scope of `eval-suite-plan`).

## Rationale

- **Consistency with existing SDK surface.** `Agent.create / Agent.batch`,
  `Cron.create`, `Theokit.*` all use the same class+factory pattern. Adding
  a `defineEval()` style (Mastra) would create two patterns to learn.
- **Type ergonomics.** Class-based gives consumers stable IDE intellisense
  for `Eval.create({...})` autocompletion.

Alternatives rejected:

- `defineEval()` (Mastra-style) — works but parallels SDK conventions.
- `runEval(opts)` (function-only) — loses the ability to add lifecycle
  helpers later (`instance.warmup()` etc).

## Consequences

- Enables: familiar surface for any SDK consumer.
- Constrains: result type is `Promise<EvalRun>` not iterator; partial-stream
  API is a v2 add.
