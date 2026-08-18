---
"@theokit/sdk": minor
"@theokit/sdk-tools": patch
"@theokit/acp": patch
"@theokit/cli": patch
---

The reference docs no longer ship inside the package. `node_modules/@theokit/sdk/docs/` is gone, along with the `harness-capability-map.md` and `error-codes.md` files it carried — the `docs` entry was removed from the published `files` list and the build step that generated it was removed with it.

The exported TypeScript types are now the only reference surface, and they remain the canonical contract: every public primitive carries its import path, signature and JSDoc example, surfaced by your editor. Nothing about the runtime API changed.

The scaffolded agent context still ships, unchanged, under `claude-template/`.
