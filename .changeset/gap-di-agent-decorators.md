---
"@theokit/di-agent": minor
---

Decorator-driven agent-team + workflow authoring (own identity — composition over a new engine).

- **`@Squad(metadata)`** property decorator + `readSquadMetadata` — declarative sequential agent team backed by `@theokit/di` `METADATA_KEYS.SQUAD`. Cross-validation Gap 1.
- **`@Step(metadata?)`** method decorator + `readStepMetadata` (`{ after?, name? }`) backed by `METADATA_KEYS.STEP`.
- **`buildWorkflow(instance)`** — compiles a class decorated with `@Step` into a `@theokit/sdk` `Workflow` (topological order by `after`; validates no-steps / unknown-after / cycle). No new runtime engine — composes `@theokit/sdk/workflow`. Cross-validation Gap 2.

First npm publish of these decorators (`0.1.0` on npm is the scaffold).
