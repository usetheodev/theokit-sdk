# D209 — `EvalRun` is plain serializable JSON; no class methods on the result

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`EvalRun` is a plain TypeScript interface. No class methods. `JSON.stringify(run)`
just works.

Convenience renderers (markdown, HTML, diff) ship as top-level functions:

```ts
import { Eval } from "@usetheo/sdk";
const md = Eval.toMarkdown(run);  // Helper, not run.toMarkdown()
```

Mirrors the existing `toShareGptTrajectory` helper pattern.

## Rationale

- **Persistence-friendly.** Disk dumps, webhook bodies, diffs against baselines
  all need plain JSON. Class methods would survive `JSON.stringify` round-trip
  loss only if rebuilt on the consumer side.
- **HTML rendering needs raw data.** UI consumers shouldn't have to call
  methods to extract data — they should map over arrays directly.

Alternatives rejected:

- **`EvalRun` as a class with `.report()`** — breaks persistence + diff use cases.

## Consequences

- Enables: `JSON.stringify(run)` direct; structural diffing easy.
- Constrains: renderers are exports, not methods; consumers building their
  own renderers don't subclass.
