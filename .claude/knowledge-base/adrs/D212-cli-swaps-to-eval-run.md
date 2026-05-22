# D212 — CLI `packages/cli/src/eval/runner.ts` swaps to call `Eval.run()`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

The CLI eval runner becomes a thin adapter:

```
parse eval.config.{ts,mjs} → translate to EvalOptions → await Eval.create(opts).run() → format markdown
```

The public `EvalConfig` shape stays identical to D199 — no breaking change
to user-authored configs. The translation is 1:1 because D199 was designed
against this future API.

## Rationale

- **D199 explicitly committed** to "swap when Eval.run ships". Phase 6 of
  eval-suite-plan cashes that check.
- **One source of truth for execution.** Anything more complex duplicates
  the SDK.

Alternatives rejected:

- **Keep CLI's own loop** — duplicates SDK; bug fixes don't propagate.

## Consequences

- Enables: SDK changes propagate to CLI automatically.
- Constrains: CLI version bumps when SDK Eval shape evolves; existing 18
  CLI eval tests must remain green (regression coverage).
