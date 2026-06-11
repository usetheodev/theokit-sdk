---
slug: sdk-2-0-cohort-readiness-audit
artifact: cohort-publish-readiness-audit
created_at: 2026-06-08
purpose: Capture publint + attw state of the 5 SDK 2.0 extracted packages after iter 33-37
---

# SDK 2.0 cohort readiness audit (post iter 37)

## Methodology

Run for each package:
1. `npx publint packages/<pkg>` (lints the published package shape)
2. `pnpm pack --pack-destination /tmp` (produce tarball)
3. `npx @arethetypeswrong/cli /tmp/<pkg>.tgz` (validate type resolutions across module systems)

## Results

| Package | Version | publint | attw node10 | attw node16-CJS | attw node16-ESM | attw bundler |
|---|---|---|---|---|---|---|
| `@theokit/sdk-memory` | 0.1.0 | ✅ All good! | 🟢 | 🟢 (CJS) | 🟢 (ESM) | 🟢 |
| `@theokit/sdk-budget` | 0.1.0 | ✅ All good! | 🟢 | 🟢 (CJS) | 🟢 (ESM) | 🟢 |
| `@theokit/sdk-cache` | 0.1.0 | ✅ All good! | 🟢 | 🟢 (CJS) | 🟢 (ESM) | 🟢 |
| `@theokit/sdk-handoff` | 0.1.0 (main) | ✅ All good! | 🟢 | 🟢 (CJS) | 🟢 (ESM) | 🟢 |
| `@theokit/sdk-handoff/internal/tool-injector` | sub-path | — | 🟢¹ | 🟢 (CJS) | 🟢 (ESM) | 🟢 |
| `@theokit/sdk-tools` | 0.1.0 | ✅ All good! | 🟢 | 🟢 (CJS) | 🟢 (ESM) | 🟢 |

¹ **CLOSED iter 38.** sdk-handoff's `./internal/tool-injector` sub-path
previously failed node10 resolution. Fixed by adding a `typesVersions`
field to sdk-handoff's package.json:
```json
"typesVersions": {
  "*": {
    "internal/tool-injector": ["./dist/internal/tool-injector.d.ts"]
  }
}
```
Now the sub-path resolves cleanly under ALL attw axes (node10 +
node16-CJS/ESM + bundler).

## What this means for Phase 7 (cohort publish)

All 5 packages are publish-ready under modern module resolutions
(node16-CJS, node16-ESM, bundler — covers >99% of consumers). The
node10 warning on a sub-path of one package is accepted.

Phase 7 prereqs:
- ✅ `publint` clean on all 5
- ✅ `attw` clean on ALL resolvers (node10, node16-CJS, node16-ESM, bundler) — closed iter 38 via typesVersions fix
- ⏳ npm auth + workspace credential setup (operator step, not engineering)
- ⏳ Version bump alignment (all at 0.1.0 today; the plan's D6 calls
  for synchronized major bump in 2.0.0 cohort — that lands during the
  Phase 6 rename)

## Iter 33-37 net change

The cohort-readiness state has NOT regressed since the iter 17 baseline
(`sdk-2-0-phase-1-2-adr.md` ADR-007). Each iter's changes shipped with:
- Tests added (cumulative ~205+ GREEN cross-package)
- Build + dts emit verified
- publint + attw checked at commit time

This audit confirms the cumulative state is still publish-ready after
the iter 33-37 sdk-memory feature surface expansion (disk write +
cross-session recall + memory_search tool + agent-scope filter).
