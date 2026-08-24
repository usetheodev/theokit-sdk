# @theokit/sdk-cache

Semantic LLM response cache for `@theokit/sdk`. Vector + FTS hybrid lookup, in-memory + JSON file stores. Integrates with `Agent` via the Plugin protocol — zero coupling to the agent kernel.

Extracted from `@theokit/sdk@1.7.0` as part of the SDK 2.0 package split (ADRs D249-D266).

## Install

```bash
pnpm add @theokit/sdk @theokit/sdk-cache
```

## Quick start

```typescript
import { Agent } from "@theokit/sdk";
import { Cache } from "@theokit/sdk-cache";

const cache = Cache.semantic({
  embedder: myEmbedderRuntime,    // EmbeddingRuntime (D11)
  threshold: 0.85,
  ttl: { default: "1h", exclude: /weather|today|now/i },
  namespace: "my-app",
  modelId: "openai/gpt-4o-mini",
});

const agent = await Agent.create({
  model: { id: "openai/gpt-4o-mini" },
  plugins: [cache.asPlugin()],
});

await agent.send("What is the capital of France?");   // miss → LLM
await agent.send("Tell me the capital of France");    // semantic hit
```

## API

### `Cache.semantic(options): Cache`

Constructs a semantic cache instance with vector similarity + FTS hybrid lookup.

| Option | Type | Default | Notes |
|---|---|---|---|
| `embedder` | `CacheEmbedderRuntime` | (required) | Minimal subset of `EmbeddingRuntime` the cache uses. |
| `threshold` | `number` (0-2) | `0.85` | Cosine similarity threshold for hit/miss. |
| `ttl` | `string \| number \| CacheTTLConfig` | (none) | TTL config — `"1h"`, `30 * 60`, or `{ default, exclude }`. |
| `namespace` | `string` | `"default"` | Logical bucket for keys. |
| `modelId` | `string` | (required) | LLM model identifier (used in cache key composition). |
| `store` | `"memory" \| { backend: "json", dir }` | `"memory"` | Persistence backend. |

### `createLexicalEmbedder(dimension = 256): CacheEmbedderRuntime`

A built-in, zero-dependency embedder so you can use `Cache.semantic` without wiring an LLM embedding API. It produces a deterministic token-hash frequency vector, L2-normalized (id `theokit-lexical-v1-d{dimension}`, model `theokit-lexical-hash`). Identical text yields identical vectors (exact-repeat hits) and lexically similar text yields nearby vectors (cosine-similar hits). It carries no semantic understanding — for that, supply an LLM-backed `CacheEmbedderRuntime`. Empty/whitespace text maps to the zero vector.

```ts
import { Cache, createLexicalEmbedder } from "@theokit/sdk-cache";

const cache = Cache.semantic({ embedder: createLexicalEmbedder() });
```

### `cache.asPlugin(): Plugin`

Returns a `Plugin` compatible with `Agent.create({ plugins })`. The plugin hooks `preUserSend` (cache lookup) and `postAssistantReply` (cache store).

### `cache.stats()`

Returns runtime stats — `{ hits, misses, entries, namespace }`.

### `cache.clear()`

Clears the in-memory state. For the JSON file store, deletes the persisted state on disk.

## Errors

An embedder failure never surfaces as an error: every path degrades to a cache miss or a skipped write, warns on stderr, and increments `CacheStats.embedderFailures`. That counter is how you detect a broken embedder.
- `CacheInvalidTtlError` — TTL string failed parse (e.g., `"-5m"` or `"abc"`). Thrown pre-construction.

## How it fits with `@theokit/sdk`

- **Foundation:** `definePlugin` + `Plugin` types come from `@theokit/sdk`.
- **Persistence primitives:** `atomicWriteText`, `PersistenceSchema` come from `@theokit/sdk/internal/persistence` (semver-exempt internal API).
- **No kernel coupling:** the cache subsystem never imports from `@theokit/sdk/internal/runtime` or the agent loop. Integration is exclusively through the plugin hooks.

## Migration from `@theokit/sdk@1.x`

Before (1.x):

```typescript
import { Cache, Agent } from "@theokit/sdk";
```

After (2.x):

```typescript
import { Agent } from "@theokit/sdk";
import { Cache } from "@theokit/sdk-cache";
```

See the monorepo `CHANGELOG.md` for the 1.x → 2.0 package-split migration notes.

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

Apache-2.0.
