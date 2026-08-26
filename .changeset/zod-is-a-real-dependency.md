---
"@theokit/sdk": patch
---

`zod` is now a regular dependency, so `npm install @theokit/sdk` produces a package that imports.

It was declared as an OPTIONAL peer dependency while 27 source files imported it — 14 of them at
module scope, on the paths that load agent context, read credentials and parse persistence. npm
honoured the declaration and did not install it, so a fresh consumer hit
`Cannot find package 'zod'` on the first line of the quickstart, from `dist/index.js` itself. 12 of
the 33 published subpaths could not be loaded at all.

Every suite in this repository runs inside the workspace, where `zod` is hoisted whether or not the
package declares it — which is why 5000+ green tests, `publint` and `attw` all saw nothing. The
release chain now packs the tarball, installs it outside the workspace and imports every declared
subpath, so this class of defect fails before publishing rather than after.

Consumers already on `zod ^4` are unaffected: the ranges overlap and the tree still resolves to a
single copy, so a schema you build still crosses into the SDK as the same type.
