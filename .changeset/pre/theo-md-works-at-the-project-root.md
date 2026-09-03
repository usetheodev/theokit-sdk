---
"@theokit/sdk": minor
---

`THEO.md` now works at the project root, the way `AGENTS.md`, `GEMINI.md` and `CLAUDE.md` already
do — found from the root, and reachable by walking up from any subdirectory.

Before this, `THEO.md` was the only context file this SDK knows about that had to live inside
`.theokit/` and could not be found from a subdirectory. The miss was silent: a well-formed
`THEO.md` at the project root was simply never read, with no warning that it had been ignored.

```
project/
├── THEO.md              ← now read, walking up from any subdirectory
└── .theokit/
    └── THEO.md           ← still works exactly as before
```

A new `DEFAULT_DISCOVERY_SPECS` entry (`THEO.md.root`, priority 55) is added alongside the
existing one — nothing about `.theokit/THEO.md` changes, so a project already using it keeps
working unchanged. When both exist, `.theokit/THEO.md` is the later, winning source on conflict —
the precedence usetheokit/theokit-sdk#531 asked for.

The new entry sets `followImports: true`, unlike `.theokit/THEO.md` (`false`) and unlike
`AGENTS.md`. This is deliberate, not an inconsistency: a root-level `THEO.md` is edited by the same
people, in the same place, as `CLAUDE.md`/`GEMINI.md` — the two other root-level files, both
`followImports: true` — so it belongs in their category rather than `AGENTS.md`'s vendor-neutral,
import-free one. Flagged as an open decision in the issue; resolved here because adding a new spec
rather than reusing the existing one meant it could be decided on its own merits, with zero
behaviour change for existing `.theokit/THEO.md` files either way.

Closes usetheokit/theokit-sdk#531.
