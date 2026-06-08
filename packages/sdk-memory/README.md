# @theokit/sdk-memory

Memory subsystem for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk).
Implements the kernel-facing `MemoryProvider` port (SDK 2.0 Phase 1 / T1.1 —
Hexagonal Architecture / SOLID Dependency Inversion).

```ts
import { Agent } from "@theokit/sdk";
import { createInMemoryMarkdownProvider } from "@theokit/sdk-memory";

const agent = await Agent.create({
  agentId: "support-bot",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
  memoryProvider: createInMemoryMarkdownProvider(),
  // ...other options
});
```

## What ships today (v0.1.0)

- `createInMemoryMarkdownProvider()` — a working `MemoryProvider` whose
  facts live in-process. Persists facts via the LLM-facing
  `memory_remember` tool; surfaces recalled facts as `systemPromptAdditions`
  on every turn; `dispose()` clears state. Useful as:
  - a stepping stone past the no-op default shipped in sdk-core, and
  - a worked reference for authors of richer providers.

## What's coming (future versions)

- `createLanceMemoryProvider(...)` — persistent LanceDB-backed store
  with semantic recall via embedding adapters (OpenAI / Ollama / etc.).
- Circuit-breaker + active-memory cache for hot-path resilience.
- Multi-adapter fan-out (write to multiple stores; merge-dedup recall).
- Dreaming sweep + memory revisions.

## Architecture

This package is a **port consumer**, not a kernel mod. The contract
lives in `@theokit/sdk/internal/runtime/memory-provider.ts` and is
exposed to consumers via:

```ts
import type {
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
} from "@theokit/sdk";
```

The agent loop calls the port's four lifecycle methods at well-defined
hook points (init / buildTools / runActivePass / dispose). Your impl
fulfills the contract; sdk-core never imports this package directly —
that's the seam that makes the split possible.

## License

Apache-2.0 © useTheo
