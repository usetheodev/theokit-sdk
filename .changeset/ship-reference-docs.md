---
"@theokit/sdk": patch
---

docs: ship the reference docs inside the npm package. `harness-capability-map.md` (every public primitive + its import path) and `error-codes.md` (the `AgentRunError.code` table) are now readable offline at `node_modules/@theokit/sdk/docs/`, pinned to the installed version — useful for agents that read their own dependencies, and for air-gapped setups. They live at the repo root (linked from the root README/CONTRIBUTING/CLAUDE.md) so `build` copies them into the package via `scripts/copy-docs.mjs`, rewriting repo-relative links to absolute GitHub URLs so they still resolve from `node_modules`. A `tests/lint/shipped-docs.test.ts` gate fails if `files` drops the `docs` entry or a new root reference doc is not added to the ship list. Tarball grows ~7 KB. The package README now also points agents at the docs site's machine-readable corpora (`llms.txt` / `llms-full.txt`).
