---
"@theokit/sdk": patch
---

fix(build): emit `@theokit/sdk/interactive` CJS type declarations (`dist/interactive/index.d.cts`). The subpath was added to `tsconfig.tools-dts.json` (so `.d.ts` shipped) but omitted from `scripts/mirror-dts-to-cts.mjs`, so `exports["./interactive"].require.types` pointed at a file that was never generated — `publint` and `arethetypeswrong` both flagged it ("No types" from CJS). A CJS `require("@theokit/sdk/interactive")` now resolves its types. Added `dist/interactive` to the mirror target list with a note about the drift trap.
