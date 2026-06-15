---
"@theokit/di": patch
---

Add `METADATA_KEYS.SQUAD` (`"usetheo:di:squad"`) and `METADATA_KEYS.STEP` (`"usetheo:di:step"`) — new metadata keys backing the `@Squad()` and `@Step()` decorators in `@theokit/di-agent`. Shipped as a patch (additive values on the existing exported `METADATA_KEYS`) to keep `@theokit/di-agent` and the in-progress `@theokit/orm` (prerelease `0.1.0-next.1`) inside their `^0.1.0` peer range — a `minor` (`0.2.0`) would fall outside `^0.1.x` and force both dependents to `1.0.0`.

Also: broke the `container.ts ↔ internal/module-loader.ts` type-only cycle (arch-review ADR 0001) — `loadModule` now depends on a narrow `ModuleRegistrar` interface from the leaf `types.ts` instead of the concrete `Container`. No behavior change; `Container` satisfies it structurally.
