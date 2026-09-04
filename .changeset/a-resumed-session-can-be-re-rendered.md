---
"@theokit/sdk": minor
---

A host can read the messages a session already contains

`readSessionMessages` was compiled into the package and missing from the type surface, so a
surface that repointed a session could not re-render it: the messages were on disk, the SDK
read them to give the model its context, and the screen stayed empty while the model
demonstrably remembered.

```ts
import { readSessionMessages } from "@theokit/sdk";

const history = await readSessionMessages({ sessionId, cwd: projectDir });
for (const m of history) render(m.role, m.text);
```

`cwd` defaults to `process.cwd()`, and `sessionDir` is only needed when the agent was created
with `local.sessionDir`. A session that was never written resolves to `[]` — a fresh session
has no history, which is not an error.

The internal reader takes a `SessionStore`; this one does not, so the transcript layout and
the record shape stay private. A host that already has a custom store can read from it
directly. (#546)
