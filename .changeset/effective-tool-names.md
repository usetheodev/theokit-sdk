---
"@theokit/sdk": minor
---

`effectiveToolNames` — ask what tools an agent will actually have (#583)

`Agent.describe()` was the only reflection surface, and it builds its catalog as
`(options.tools ?? [])` — literally the array the caller passed. The SDK's own builtins were never in
it, so the two states that matter most were indistinguishable:

```
Agent.create({ tools: [] })                    describe().tools = []   ← holds a shell
the same + withheldBuiltinTools: ["shell"]     describe().tools = []   ← holds nothing
```

A consumer confirming that a role declared read-only really is one had no instrument. What they did
instead, measured in a real session: ask the agent to enumerate its own catalog — needs a credential,
needs the network, and returns the list the *model* decided to write. That same session recorded a
subagent answering *"I can't run shell commands in this environment"* while its catalog listed
`shell`. An attempt measures the model's disposition; the catalog measures its authority.

```ts
import { effectiveToolNames } from "@theokit/sdk";

const { names, unresolved } = effectiveToolNames({ tools: [], withheldBuiltinTools: ["shell"] });
// names: []          — the shell is genuinely gone
// unresolved: []     — nothing else could contribute, so [] is the whole catalog
```

**Options in, not an agent id** — synchronous, credential-free, answerable *before* the agent runs,
so a test can compare what it declared against what the runtime will declare. `describe()` needs a
registered agent and answers too late for that.

**Not a bare array**, deliberately. MCP tools need a live connection; plugin tools and the reasoning
`think` tool are assembled per run. Returning `string[]` would rebuild the original defect one
function over. `unresolved` names the sources that are configured and could not be enumerated, and is
empty when none are — which is the only condition under which `names` may be read as complete.

Requested, with this exact shape and rationale, by the `theocode` session after it had to work around
the gap by extracting a subagent spec into a separate function just to assert on it.
