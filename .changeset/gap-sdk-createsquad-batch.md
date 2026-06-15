---
"@theokit/sdk": minor
---

`createSquad` sequential agent-team convenience + `Agent.batch` boundary validation — first real npm publish.

- **`createSquad(options)`** — composes `Workflow.create()` + `agentStep` into a sequential agent team (own identity; not a framework copy). Throws `ConfigurationError` (`invalid_squad` for empty agents, `squad_process_unsupported` for hierarchical). Cross-validation Gap 1.
- **`Agent.batch`** now fail-fast validates `concurrency` + prompt items at the public boundary (`ConfigurationError` with `invalid_concurrency` / `invalid_batch_item`) before any side effect. Cross-validation Gap 3.

Note: these features were tagged as `v1.8.0` but that version's npm publish failed (CI build cycle, fixed in `turbo.json`); `1.8.0` / `1.8.1` on npm predate them. They are published to npm for the first time in `1.9.0`. The `[1.8.0]` CHANGELOG section is retained as the GitHub-released record and is not rewritten.
