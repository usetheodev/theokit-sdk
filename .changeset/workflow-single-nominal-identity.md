---
"@theokit/sdk": patch
---

`Workflow` is now one type across `@theokit/sdk` and `@theokit/sdk/workflow`.

The two entries were built by different declaration pipelines and each emitted its own
`declare class Workflow`. A class with a private field is compared nominally, so the documented
combination — `import { Workflow } from "@theokit/sdk/workflow"` passed to `Cron.create` from the
root — was rejected with "types have separate declarations of a private property '_options'".
Nothing in-tree crosses that boundary, because in-tree code imports from `src/`.

Both entries now resolve to a single declaration, and a new `quality:dts-identity` gate fails the
build if any exported class is ever declared twice across published entries again.
