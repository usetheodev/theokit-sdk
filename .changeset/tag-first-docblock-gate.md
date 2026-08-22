---
"@theokit/sdk": patch
---

Seventeen module docblocks that opened with `@theokit/...` are rewritten to open with a sentence.

A JSDoc block whose first line begins with `@` has no description: TypeScript parses the whole block
as that tag's value, so `getDocumentationComment()` returns nothing and editor tooltips, TypeDoc and
this repo's doc-coverage instrument all report the symbol as undocumented while the source plainly
documents it. The affected files are the `server/auth` and `subscription` surfaces; the same words
now appear in an order the tooling can read.

A new `quality:doc-tag-first` gate fails the build on the shape, so it cannot come back.
