---
"@theokit/sdk-cache": patch
---

Raises the `@theokit/sdk` peer floor from `>=4.0.0` to `>=4.54.0`, which is what this package
actually needs.

It reads `PostAssistantReplyContext.usedTools` to avoid replaying an answer that came from a tool
call, and that property first shipped in 4.54.0. The declared range therefore promised compatibility
with versions where installing it produces a build that fails:

```
src/cache.ts(239,26): error TS2339: Property 'usedTools' does not exist on
type 'PostAssistantReplyContext'.
```

Found by the CI leg that installs each package at the bottom of its own declared range and builds it
— not by any test in the repository. The existing floor test checks the MAJOR only, so `>=4.0.0`
satisfied it while being wrong. That limitation is now recorded there, along with this floor pinned
so it cannot silently drop back.
