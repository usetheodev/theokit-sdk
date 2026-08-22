---
"@theokit/sdk": patch
"@theokit/sdk-handoff": patch
---

Every symbol these packages declare in `exports` now reaches the `.d.ts` they publish.

Sixty-six declarations across twenty-three published files did not compile, and four entry
points silently omitted names their own barrel exports — `@theokit/sdk/internal/security`
dropped seven at once. Runtime was never affected; this is types-only. A consumer with
`skipLibCheck` on saw nothing, and a consumer running type-aware lint saw every type reached
through one of them degrade to `error`.

The cause was `stripInternal`, which deletes a declaration when the literal `@internal`
appears in ANY leading comment range of it. The tag was being used here to mean "outside the
semver contract" — `internal/persistence/sqlite-open.ts` said so in those words, on a subpath
the manifest publishes and a back-compat test pins. The compiler reads it as "erase this", and
the two meanings only diverge in the published artifact. It now says the semver exemption in
prose, and the tag is gone from the symbols that are published.

Two further mechanisms had the same cause and a wider blast radius. A tag in a BARREL header
deleted the first `export … from` beneath it; a tag in a MODULE header deleted the following
`import`, so `import { z } from "zod"` vanished and every type it bound became
`Cannot find name`. Nothing was added to any `exports` map and no `export` line changed — a
deleted import was never privacy, only a broken declaration.

`@theokit/sdk-handoff`'s `./internal` entry left `SDKAgent` and `CustomTool` unbound, from a
different defect: the declaration repair only ever looked at `exports["."]`, so it fixed each
package's main entry and shipped the rest unrepaired. It now covers every declared subpath, and
binds the side-effect import form (`import '@theokit/sdk';`) the rollup emits with the names
stripped out.

Three gates were widened or added so this cannot return silently: the declaration typecheck
now covers all 45 published entries rather than 12, a new export-parity check fails when a
source barrel exports a name the emit omits, and public-API documentation coverage is gated at
100%.

Two consequences worth naming rather than discovering. `coerceToKnownAgentRunErrorCode` — the
boundary helper the 4.x release notes point at as the migration path off the open
`AgentRunErrorCode` union — was tagged internal and therefore absent from the published types; it
is now exported and documented, which is a small addition to the public surface. And
`packages/sdk/typedoc.json` sets `excludeInternal: true`, so the generated API reference gains the
~57 symbols whose tags were removed. That is the intended direction: those symbols are published,
and the reference now says so.
