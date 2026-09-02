---
"@theokit/sdk": minor
---

Three silent downgrades now tell you they happened. Behaviour is unchanged; visibility is not.

**A failing `MemoryProvider` no longer disappears quietly.** `initLoopContext` caught every provider
failure into an empty value: an `init` failure meant no memory tool was registered, a `buildTools`
failure meant no provider tools, an `activePass` failure meant no recalled context in the system
prompt. The agent answered without the memory it was configured with, and nothing recorded it. There
is now a `memory_degraded` run event — new `RunMemoryDegradedEvent`, carrying the stage and the
provider's own message — alongside a stderr diagnostic, so a host can show "memory degraded" instead
of a healthy run. Degrading to a working agent is still what happens.

**The memory FTS fallback is gated on the case it was written for.** Any SQL failure used to become a
`LIKE '%query%'` scan over the whole table, returning plausible hits at a fixed score — so a corrupt
database, a missing FTS table and a disk error all looked like a successful search with worse
relevance. The fallback still runs, and a non-CJK failure now reports that the index may be missing
or corrupt.

**A `@theokit/sdk-memory` peer that fails to load says so.** Absent is expected and stays silent;
present-but-unloadable — a module-format interop failure, a broken native dependency, a bundler
rewrite — is reported instead of falling back to the legacy path in silence.
