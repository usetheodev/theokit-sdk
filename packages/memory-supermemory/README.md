# @theokit/memory-supermemory

Supermemory memory adapter for [`@theokit/sdk`](../sdk).

Wraps [`supermemory@^4`](https://www.npmjs.com/package/supermemory) (zero-dep,
MIT-licensed, native fetch) with the `MemoryAdapter` contract from ADR D141.

## Install

```bash
pnpm add @theokit/memory-supermemory supermemory
```

## Usage

```ts
import { Agent } from "@theokit/sdk";
import { supermemoryMemory } from "@theokit/memory-supermemory";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: {},
  plugins: [supermemoryMemory({ apiKey: process.env.SUPERMEMORY_API_KEY! })],
  memoryContext: { userId: "demo" },
});

// Direct API
await agent.memory.write("User likes Brazilian jazz", { userId: "demo" });
const facts = await agent.memory.recall("music preferences", { userId: "demo" });

// LLM-driven via tool schemas (registered automatically when toolSchemas: true)
await agent.send("What music does the user enjoy?");
```

## Options

| Field | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Supermemory API key. Required. |
| `baseUrl` | `string` | Supermemory cloud | Override for self-hosted deployments. |
| `containerTagPrefix` | `string` | `"theokit"` | Prefix for every container tag. Useful for test isolation. |

## Container tag scheme

Every memory write is tagged with:

- `${prefix}:user:${userId}` (always)
- `${prefix}:agent:${agentId}` (when set)
- `${prefix}:tenant:${tenantId}` (when set)
- `${prefix}:tag:${tag}` (one per entry in `ctx.tags`)

Each component is sanitized against `^[a-zA-Z0-9_-]+$` (EC-C) — values
containing `:` or whitespace throw `MemoryAdapterError(code: "invalid_input")`
at the boundary, before any HTTP call.

## Multi-tenant accumulation (EC-S)

Calling `agent.memory.write` writes durable data to Supermemory tied to
the supplied `userId`. In bot/CI scenarios where the same `userId` is
reused across runs, set a unique `containerTagPrefix` per test:

```ts
supermemoryMemory({
  apiKey,
  containerTagPrefix: `theokit-test-${Date.now()}`,
})
```

## Failure modes

| HTTP status | Maps to | `isRetryable` |
|---|---|---|
| 401 / 403 | `MemoryAdapterError(code: "auth_failed")` | false |
| 429 | `MemoryAdapterError(code: "rate_limited")` | true |
| 404 | `MemoryAdapterError(code: "not_found")` | false |
| Network/timeout | `MemoryAdapterError(code: "network")` | true |
| Other | `MemoryAdapterError(code: "unknown")` | false |

## API reference

Every symbol this package exports, with the exact specifier to import it from, is in the generated
capability map that ships inside `@theokit/sdk`:

```
node_modules/@theokit/sdk/docs/harness-capability-map.md   # symbol -> import specifier
node_modules/@theokit/sdk/docs/error-codes.md              # every `code` an error can carry
```

Both are generated from the built type declarations, so they describe the version you installed
rather than the version someone wrote a page about.

## License

Apache-2.0. See [LICENSE](./LICENSE).
