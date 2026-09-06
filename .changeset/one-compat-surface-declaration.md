---
"@theokit/sdk": patch
---

`CompatSurface` is declared once (#586)

It was declared twice, independently — `types/agent.ts` (public, typing
`AgentOptions.local.compatSources`) and `internal/runtime/compat/foreign-config-sources.ts` (typing
the admission logic and `persistence/paths.ts`). Neither imported the other.

Measured: adding a member to one alone produced **zero** type errors. Structurally identical unions
compare equal, so the two halves of one public contract could stop agreeing about which surfaces
exist, silently. Widen the public type and a caller declares a surface the admission logic ignores;
widen the internal one and the loader admits a surface no public caller can name. Both produce a
declaration that reads as honoured and is not.

`types/` is a leaf by design, so the public declaration stays and the internal module imports it.

The runtime list `COMPAT_SURFACES` cannot be derived from a type, so it remains a second copy of the
members — and a compile-time exhaustiveness check now pairs the two, in both directions.

**The first version of that check was decorative and this is worth recording:** annotating the list
`readonly CompatSurface[]` widens each entry back to `CompatSurface`, so the check compared a type
against itself and passed on any drift. It was caught by testing the guard rather than trusting it —
a member added to the public type produced zero errors. `as const satisfies` keeps the literals.
