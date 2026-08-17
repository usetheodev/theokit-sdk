---
"@theokit/sdk-pty": patch
"@theokit/cli": patch
"@theokit/acp": patch
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
"@theokit/memory-supermemory": patch
---

**`@theokit/sdk-pty` declares its licence.** Every published version up to now shipped with no `license` field in the manifest. npm reads the field, not the directory, so the tarball was all-rights-reserved to whoever installed it — the terms were sitting in the `LICENSE` file it already shipped, saying nothing. The field now says `Apache-2.0`, which is what that file has always been and what all eleven sibling packages declare.

**Four packages now ship the licence they declare.** `@theokit/cli`, `@theokit/memory-honcho`, `@theokit/memory-mem0` and `@theokit/memory-supermemory` declared `Apache-2.0` and listed `LICENSE` in `files`, and no such file existed. npm omits a declared-but-absent path in silence, so every published tarball asserted the licence while carrying none of its terms — and §4(a) requires a copy to travel with the distribution. The file is there now, byte-identical to the one the other packages ship.

**Six packages complete the rest of their published metadata.** Each field is here for what its absence costs a consumer:

- `homepage` and `bugs` — the npm page renders both; without them someone who hits a defect has no route back to the project.
- `engines.node` — npm warns on an unsupported runtime only when the range is declared. `@theokit/sdk-pty` declared none, so a Node 18 install failed later and somewhere unrelated.
- `sideEffects` — a bundler keeps every module of a package that stays silent. Declared only after checking: a clean scan of each built ESM entry found zero top-level statements, the residual hits being closing tokens of declarations. `@theokit/sdk` keeps its path-array form, which is the honest shape for a package whose agent entry registers on import.
- `publishConfig.access` — a scoped package defaults to `restricted`. Three declared none and reached npm public only because the release flow supplied the flag; the manifest states it now instead of depending on how it is invoked.
- `@theokit/sdk-pty` also ships its `CHANGELOG.md`, which existed on disk and was absent from `files`.

The gate that should have caught any of this covered three packages out of twelve, by way of a hand-written list. It now derives the list from `packages/`, asserts the whole contract, and fails when the sweep discovers nothing rather than passing by having nothing to check.
