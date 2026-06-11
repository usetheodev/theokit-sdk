# no-orphans snapshot — 2026-06-07 (T0.2)

Plan: arch-review-fixes-2026-06-06 § Phase 0 / T0.2 (EC-3).

## Tool + command

```bash
pnpm exec depcruise --config .dependency-cruiser.cjs packages/sdk/src
```

`dep-cruiser` is the gate for orphans (per T0.1 architecture decision — `madge` covers cycles via `pnpm run quality:cycles`; `dep-cruiser` covers orphans + layering).

## Result at HEAD (post-T5.1 + T10.1 sub-folder promotions)

```
✔ no dependency violations found (371 modules, 762 dependencies cruised)
```

**0 orphans.** Includes the recently moved sub-folders:

- `internal/runtime/fixtures/` (iter-15)
- `internal/runtime/context/` (iter-16)
- `internal/runtime/registry/` (iter-17)
- `internal/runtime/plugins/` (iter-18)
- `internal/memory/storage/` (iter-14)

The pre-existing `pathNot` exclusion list (covering `tests/`, `tools/`, `src/internal/`, `src/types/`, `dist/`) remained adequate — no new excluded paths needed.

## Per-feature internal namespaces

The pre-existing exclusion `(^|/)packages/sdk/src/[^/]+/internal/` continues to cover `src/subscription/internal/` (added by G8 streaming primitive) — no maintenance burden from sub-folder promotions during T5.1.

## Sunset

This snapshot is informational. The live `no-orphans` rule fires on every `pnpm run quality:depcruise` (and `pnpm run quality` umbrella). If a future refactor introduces an orphan, depcruise will fail the CI gate immediately.

## Related rules

- `tools/check-cycles.mjs` (T0.1 — madge primary cycle gate, threshold ≤ 3).
- `.dependency-cruiser.cjs` § `no-orphans` (T0.2 — this snapshot).
- `quality-gates.md` G5 + G7 (umbrella docs).
