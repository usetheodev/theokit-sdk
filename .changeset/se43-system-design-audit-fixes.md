---
"@theokit/sdk": minor
"@theokit/sdk-tools": patch
"@theokit/sdk-memory": patch
"@theokit/sdk-cache": patch
"@theokit/sdk-handoff": patch
"@theokit/sdk-budget": patch
---

SE43 — system-design audit fixes (public-surface changes).

- **`@theokit/sdk` (minor):** the shared persistence kernel is now reachable from the sanctioned public `@theokit/sdk/persistence` barrel — `withCwdMutex`, `sanitizeFts5Query`, and `PersistenceSchema` are added (joining `replaceFileAtomic` / `openSqliteResilient` / `atomicWriteText` / `atomicWriteJson`). The `@theokit/sdk/internal/persistence` export is now **deprecated**: it re-exports its full surface unchanged for one release (back-compat) and is scheduled for removal in a future major. No breaking change; existing imports keep working.
- **Satellites (patch):** `sdk-tools` / `sdk-memory` / `sdk-cache` / `sdk-handoff` / `sdk-budget` tightened their `@theokit/sdk` peer-range floor from `>=1.7.0` to `>=4.0.0`, matching the v4-only surfaces they import (prevents a non-workspace install resolving an incompatible old sdk).
