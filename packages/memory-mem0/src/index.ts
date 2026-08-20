import { Plugin } from "@theokit/sdk";

import { Mem0Adapter, type Mem0AdapterOptions } from "./adapter.js";

export type { Mem0AdapterOptions } from "./adapter.js";

/**
 * Wire Mem0 cloud as the agent's long-term memory.
 *
 * ```ts
 * const agent = await Agent.create({
 *   model: { id: "openai/gpt-4o-mini" },
 *   plugins: [mem0Memory({ apiKey: process.env.MEM0_API_KEY! })],
 * });
 * ```
 *
 * Needs `mem0ai@^3.0.0` — a REQUIRED peer dependency, not an optional one; without it the import
 * throws at load time. Cloud only: `MemoryClient` talks to Mem0's hosted API, and `mem0ai` has no
 * `MEM0_API_KEY` environment fallback, so {@link Mem0AdapterOptions.apiKey} must be supplied.
 *
 * What this adapter gives you that the others do not, and what to watch for:
 *
 * - **`history(id)` works** (`capabilities.history === true`) — it is the only adapter in the
 *   ecosystem that exposes per-memory versioning, and it backs the extra `memory_history` tool
 *   offered to the model.
 * - **`recall` is CROSS-SESSION on purpose.** Writes carry `run_id = ctx.sessionId`, but the
 *   search filter is `user_id` alone, so a recall in session B returns memories written in
 *   session A. If you need per-session isolation, use distinct `ctx.userId` values — `sessionId`
 *   will not give it to you.
 * - **`recall` defaults to `k = 10`** with server-side rerank; `write` returns the id of the first
 *   memory Mem0's server-side extraction produced, which need not be the text you sent.
 * - **`system` turns are rewritten.** Mem0 accepts only `user` / `assistant`, so a
 *   `MemoryTurnMessage` with `role: "system"` is sent as a `user` turn prefixed with `[system] `.
 *
 * Trap — the circuit breaker reports itself as a RATE LIMIT. After
 * {@link Mem0AdapterOptions.breaker} trips, every call throws
 * `MemoryAdapterError(code: "rate_limited")` with a message naming the remaining cooldown, even
 * though the cause was a 5xx or a transport failure and no request was sent. Match on the message,
 * or on the fact that the failure is instantaneous, to tell the two apart.
 *
 * Errors are always `MemoryAdapterError` with `adapterId: "mem0"` and one of
 * `auth_failed` (401/403) | `rate_limited` (429 or breaker open) | `not_found` (404) |
 * `network` (5xx, or a status-less error whose message contains "network") | `invalid_input` |
 * `unknown` (everything else, including a transport error reported as `"fetch failed"`).
 * Both `network` shapes count toward {@link Mem0AdapterOptions.breaker}; `unknown` does not.
 *
 * @public
 */
export function mem0Memory(options: Mem0AdapterOptions): Plugin {
  return Plugin.create({
    name: "@theokit/memory-mem0",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new Mem0Adapter(options),
  });
}
