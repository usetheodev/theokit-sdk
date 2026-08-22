---
"@theokit/cli": minor
"@theokit/sdk": minor
---

`theokit init` gains four templates — `chatbot`, `multi-agent`, `rag-agent` and
`workflow-automation` — and its `telegram-bot` template now installs and
compiles. It imported `createAgentFactory`, which the SE36 rename replaced with
`AgentFactory.create`, and pinned `@theokit/gateway` to the SDK's own version, so
a scaffolded project failed at `pnpm install` before any code ran.

`@theokit/cli` exports the `eval.config.ts` contract its README tells you to use:
`EvalConfig`, `DatasetEntry`, `Scorer` and `Score`.

`@theokit/sdk` exports `Workflow`, `fn` and `agentStep` from the package root.
`CronCreateOptions.workflow` types against the copy in the cron chunk, while the
`./workflow` subpath emits its own declaration of the same class — so a workflow
built the documented way was rejected by `Cron.create` on a private-field
mismatch. Importing both from the root now gives one identity.
