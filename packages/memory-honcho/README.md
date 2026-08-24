# @theokit/memory-honcho

Honcho memory adapter for [`@theokit/sdk`](../sdk).

Wraps [`@honcho-ai/sdk@^2`](https://www.npmjs.com/package/@honcho-ai/sdk) (zod
peer-dep) with the `MemoryAdapter` contract from ADR D141. Honcho's
differentiator is **dialectic reasoning** — `recall` returns ONE synthesized
answer about the user, not a list of raw facts.

## Install

```bash
pnpm add @theokit/memory-honcho @honcho-ai/sdk
```

## Usage

```ts
import { Agent } from "@theokit/sdk";
import { honchoMemory } from "@theokit/memory-honcho";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: {},
  plugins: [honchoMemory({
    apiKey: process.env.HONCHO_API_KEY!,
    workspaceId: process.env.HONCHO_WORKSPACE_ID,
  })],
  memoryContext: { userId: "alice" },
});

// Persist a turn
await agent.memory.write("User likes Brazilian jazz", { userId: "alice" });

// Recall: returns ONE synthesized reasoning answer (Honcho dialectic)
const [answer] = await agent.memory.recall(
  "What music does the user like?",
  { userId: "alice" },
);
console.log(answer.content);
```

## Options

| Field | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Honcho API key. Required. |
| `workspaceId` | `string` | env `HONCHO_WORKSPACE_ID` | Workspace scope. |
| `baseUrl` | `string` | Honcho cloud | Override for self-hosted Honcho. |

## Session namespacing (EC-D)

Honcho sessions are workspace-scoped. To prevent cross-user contamination,
this adapter prefixes every session key with `userId`:

- `agent.memory.write(content, { userId: "alice" })` → session `"alice:default"`
- `agent.memory.write(content, { userId: "alice", sessionId: "chat42" })` → session `"alice:chat42"`
- `agent.memory.write(content, { userId: "bob" })` → session `"bob:default"`

Two users without `sessionId` land in **distinct** sessions automatically.

## API reference

Every symbol this package exports, with the exact specifier to import it from, is in the generated
capability map that ships inside `@theokit/sdk`:

```
node_modules/@theokit/sdk/docs/harness-capability-map.md   # symbol -> import specifier
node_modules/@theokit/sdk/docs/error-codes.md              # every `code` an error can carry
```

Both are generated from the built type declarations, so they describe the version you installed
rather than the version someone wrote a page about.

## License & Self-Hosting

This adapter is licensed Apache-2.0.

**Note on Honcho self-hosting:** the Honcho server itself is licensed
**AGPL-3.0**. When you use the managed Honcho cloud at `app.honcho.dev`,
your application is unaffected (the network use clause applies to Honcho
Inc.'s deployment, not yours). When you **self-host** Honcho, the AGPL
network-use trigger applies to YOUR deployment: any application that
communicates with your self-hosted Honcho instance over a network may
itself need to provide source under AGPL-3.0 terms, depending on
interpretation.

If you self-host Honcho, **consult your legal team** before connecting
proprietary or closed-source applications to it. The managed cloud
avoids this concern entirely. The `@honcho-ai/sdk` npm client is
Apache-2.0 (per its `package.json`), so consuming the SDK does not
itself trigger AGPL.

## Failure modes

| Honcho error | Maps to | `isRetryable` |
|---|---|---|
| `AuthenticationError` / 401 / 403 | `MemoryAdapterError(code: "auth_failed")` | false |
| `RateLimitError` / 429 | `MemoryAdapterError(code: "rate_limited")` | true |
| `NotFoundError` / 404 | `MemoryAdapterError(code: "not_found")` | false |
| `ConnectionError` / `TimeoutError` | `MemoryAdapterError(code: "network")` | true |
| Other | `MemoryAdapterError(code: "unknown")` | false |

## Adapter semantics

- `write` calls `session.addMessages([peer.message(text)])`.
- `recall` calls `peer.chat(query, { session })` — returns ONE synthesized
  reasoning answer wrapped as a `MemoryFact` with `score: 1.0`.
- `delete` throws — `@honcho-ai/sdk@^2` does not expose a public message
  delete endpoint. Use the Honcho dashboard or wait for a future SDK
  version.
- `capabilities.history === false` and `capabilities.reasoning === true`.

## License

Apache-2.0. See [LICENSE](./LICENSE).
