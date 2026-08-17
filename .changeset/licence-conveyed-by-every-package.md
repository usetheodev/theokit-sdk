---
"@theokit/sdk-pty": patch
"@theokit/cli": patch
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
"@theokit/memory-supermemory": patch
---

**`@theokit/sdk-pty` declares its licence.** Every published version up to now shipped with no `license` field in the manifest. npm reads the field, not the directory, so the tarball was all-rights-reserved to whoever installed it — the terms were sitting in the `LICENSE` file it already shipped, saying nothing. The field now says `Apache-2.0`, which is what that file has always been and what all eleven sibling packages declare.

**Four packages now ship the licence they declare.** `@theokit/cli`, `@theokit/memory-honcho`, `@theokit/memory-mem0` and `@theokit/memory-supermemory` declared `Apache-2.0` and listed `LICENSE` in `files`, and no such file existed. npm omits a declared-but-absent path in silence, so every published tarball asserted the licence while carrying none of its terms — and §4(a) requires a copy to travel with the distribution. The file is there now, byte-identical to the one the other packages ship.

The gate that should have caught both covered three packages out of twelve, by way of a hand-written list. It now derives the list from `packages/`, asserts both halves of the contract — the field and the shipped file — and fails when the sweep discovers nothing rather than passing by having nothing to check.
