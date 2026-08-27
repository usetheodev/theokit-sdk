---
"@theokit/sdk-tools": patch
---

The declared `@theokit/sdk` peer range stops promising a version the package does not compile against.

It declared `>=4.19.3` and fails at exactly that floor, with `error TS2552: Cannot find name`. npm
resolves the combination with no `ERESOLVE` and no peer warning, and the break surfaces in the build,
far from the range that caused it.

The real floor is `4.54.0`, measured by bisecting the 116 stable 4.x releases with a real build as the
oracle: `4.53.1` fails and `4.54.0` passes. They are adjacent in the published list, so this is the
exact version rather than an interval.

This package had been excluded from the sibling finding (usetheokit/theokit-sdk#423) for declaring a
narrower range than the other four. A narrower range can still be false — it is just false over a
smaller interval (usetheokit/theokit-sdk#425).
