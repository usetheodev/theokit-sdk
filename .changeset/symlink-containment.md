---
"@theokit/sdk": patch
---

Containment guards in `safePathJoin` and `memory_get` now compare paths after symlink resolution, so a link inside the root pointing outside it is refused.
