# D222 — `Handoff` is a class with `Handoff.create(target, opts?)` factory

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Public API is `Handoff.create(target, options?)` returning a `Handoff`
instance. Raw `Agent` instances in `handoffs[]` are auto-wrapped with
defaults.

```ts
Agent.create({
  handoffs: [
    billing,                                                    // auto-wrapped
    Handoff.create(support, { inputFilter: redactCreditCards }),
  ],
});
```

## Rationale

- Consistency with SDK class+factory convention (D202 for Eval, D22 for
  Agent.create). Same mental model.

Alternatives rejected:

- **Standalone `handoff(target, opts)` function** (OpenAI style) — works
  but parallels SDK conventions.

## Consequences

- Enables IDE intellisense + same mental model as other primitives.
- Constrains: `Handoff` class has no methods beyond `.target`, `.options`
  read-only access; behavior lives in the engine.
