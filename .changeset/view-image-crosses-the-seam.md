---
"@theokit/sdk-tools": minor
---

`createViewImageTool` reaches consumers.

The tool was committed on 2026-08-14, three days after `0.26.3` went to the registry, and no version
was cut — so the published `0.26.3` and the source at `0.26.3` were different packages. Anyone
resolving the range got a build without the image tool, and `@theokit/agents` could not forward what
its dependency did not ship.

The measurable cost: TheoCode wrote `packages/agent/src/tools/view-image.ts` by hand — the only local
tool in a ten-tool registry where the other nine are framework built-ins.

Note for consumers migrating off a hand-rolled equivalent: this `toModelOutput` returns the image
block ALONE on success, and leaves a failure as text so the model can read the reason and retry.
An implementation that also emitted a leading text line will change what the model receives.
