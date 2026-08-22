import { Plugin } from "@theokit/sdk";

import { SupermemoryAdapter, type SupermemoryAdapterOptions } from "./adapter.js";

export type { SupermemoryAdapterOptions } from "./adapter.js";

/**
 * Wire Supermemory as the agent's long-term memory.
 *
 * ```ts
 * const agent = await Agent.create({
 *   model: { id: "openai/gpt-4o-mini" },
 *   plugins: [supermemoryMemory({ apiKey: process.env.SUPERMEMORY_API_KEY! })],
 * });
 * ```
 *
 * Needs `supermemory@^4.21.0` — a REQUIRED peer dependency, not an optional one; without it the
 * import throws at load time.
 *
 * Scope and shape:
 *
 * - **`sessionId` IS IGNORED** (`capabilities.sessions === false`). Every write for a user lands
 *   in the same container regardless of session, and every recall reads it back. If two
 *   conversations must not see each other's memories, give them different `ctx.userId` values —
 *   `ctx.sessionId` will not separate them.
 * - **Writes are scoped more finely than reads.** `write` tags a document with
 *   `<prefix>:user:<userId>` plus `<prefix>:agent:<agentId>`, `<prefix>:tenant:<tenantId>` and one
 *   tag per `ctx.tags` entry — but `recall` searches the USER tag alone. The agent/tenant/tag tags
 *   are write-side labels, not recall filters.
 * - **`recall` defaults to `k = 10`** with server-side rerank; `k <= 0` returns `[]` without a
 *   network call.
 * - **`delete(id)` removes the whole document** that `write` created, not a single extracted fact.
 * - **`history` is unsupported** (`capabilities.history === false`).
 *
 * Trap: every identifier is validated against `/^[a-zA-Z0-9_-]+$/` at CALL time, not at
 * construction. A `userId` such as `"user:123"`, an email address, or a
 * {@link SupermemoryAdapterOptions.containerTagPrefix} with a dot makes the FIRST `write` /
 * `recall` throw `MemoryAdapterError(code: "invalid_input")`, long after `Agent.create` succeeded.
 *
 * Errors are always `MemoryAdapterError` with `adapterId: "supermemory"` and one of
 * `auth_failed` (401/403) | `rate_limited` (429) | `not_found` (404) | `network` |
 * `invalid_input` | `unknown`.
 *
 * @public
 */
export function supermemoryMemory(options: SupermemoryAdapterOptions): Plugin {
  return Plugin.create({
    name: "@theokit/memory-supermemory",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new SupermemoryAdapter(options),
  });
}
