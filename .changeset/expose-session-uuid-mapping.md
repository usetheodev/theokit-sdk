---
"@theokit/sdk": minor
---

`@theokit/sdk/persistence` exposes `sessionUuidFor` and `legacyTranscriptPath` (#577)

Every transcript helper on this entry point went **id → path**. Nothing went the other way, and
nothing let a caller compute the forward mapping to match against — so a consumer enumerating
`projects/<encoded-cwd>/*.jsonl`, which is how you list sessions without a registry, received
filenames it could not relate to any agent id it held.

The naming scheme is deliberately one-way: a UUIDv8 over SHA-256, so the Claude Code CLI can
`--continue` a session this SDK wrote. The 5.0.0 notes say *"nothing has to be persisted to map one
back to the other"* — true of the scheme, and not true in practice, because `sessionUuidFor` lived
in the compiled JS and in zero `.d.ts`. The only route left was to reimplement the hash: an SDK
internal, copied into a consumer, silently wrong the day the scheme moves.

```ts
import { sessionUuidFor, transcriptRoot } from "@theokit/sdk/persistence";

const wanted = `${sessionUuidFor(agentId)}.jsonl`;
const mine = (await readdir(dir)).filter((f) => f === wanted);
```

**What crosses is the forward mapping, not an inverse.** A path → id function cannot exist over a
hash, and shipping one would be a lie about it. `legacyTranscriptPath` crosses alongside because a
directory written before #400 holds both spellings, and a consumer matching only the new one
reports its own history as missing — the same false absence, one rename later.

Measured on `@theokit/agents` 4.x against `5.0.1`: 29 unit tests failing from this single cause,
seen from four angles — listing, protection, GC and deletion.
