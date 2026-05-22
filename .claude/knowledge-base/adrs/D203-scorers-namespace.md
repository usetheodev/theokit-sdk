# D203 — Built-in scorers live in a separate `Scorers` namespace

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Built-in scorers ship as a namespace export from the SDK barrel:

```ts
import { Scorers } from "@usetheo/sdk";
const scorer = Scorers.containsExpected({ caseSensitive: false });
```

Scorers are curried factories: `Scorers.regex(pattern)` returns a `NamedScorer`.
They are NOT methods on `Eval` — they're a sibling concept that `Eval.run`
consumes.

## Rationale

- **Tree-shakeable.** Importing `Scorers` brings only what's used.
- **Naming clarity.** `Eval.contains(...)` would conflate the eval engine
  with the score function; separate namespace makes the layering explicit.
- **Third-party extension.** External packages can publish more scorers
  following the same `(config) => Scorer` shape without naming conflicts.

Alternatives rejected:

- `Eval.scorers.contains(...)` — nests scorers inside Eval; harder to
  import standalone.
- Flat exports (`containsScorer`, `regexScorer`) — pollutes the top barrel.

## Consequences

- Enables: clean tree-shaking + third-party scorer ecosystem.
- Constrains: `Scorers` namespace is versioned at the SDK major; breaking
  scorer signatures requires a major bump.
