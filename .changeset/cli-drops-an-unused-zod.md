---
"@theokit/cli": patch
---

Drops `zod` from the CLI's dependencies. Nothing in the package imported it — `eval.config`
validation is three hand-written checks, and the source already said so in a comment. Scaffolded
templates that use zod declare their own pin, so `theokit init` is unaffected.

It stayed hidden because the dead-dependency check counted it as satisfying the SDK's zod peer
requirement. Once the SDK declared zod itself (#399), nothing was left claiming this one, and it
surfaced immediately. Verified by removing it: the CLI typechecks and all 216 tests pass.
