---
"@theokit/sdk": minor
---

`discoverSubagents` and `loadSubagentDefinition` now accept a `settingSources` option, so a caller can decide where subagent definitions are read from instead of always reading the project directory; the parsed `AgentDefinition` type is re-exported from `@theokit/sdk/subagents-loader` so consumers can name the value they receive.
