import { Plugin } from "@theokit/sdk";

import { HonchoAdapter, type HonchoAdapterOptions } from "./adapter.js";

export type { HonchoAdapterOptions } from "./adapter.js";

/**
 * Wire Honcho as the agent's long-term memory.
 *
 * ```ts
 * const agent = await Agent.create({
 *   model: { id: "openai/gpt-4o-mini" },
 *   plugins: [honchoMemory({ apiKey: process.env.HONCHO_API_KEY! })],
 * });
 * ```
 *
 * Needs `@honcho-ai/sdk@^2.1.0` — a REQUIRED peer dependency of this package, not an optional
 * one. There is no degraded mode: if it is not installed, importing this module throws at load
 * time. The key is not read from the environment by this package; see
 * {@link HonchoAdapterOptions.apiKey} for what the vendor client does with an absent one.
 *
 * What you get, and where it differs from the other memory adapters:
 *
 * - **`recall` returns ONE synthesized answer, not `k` facts.** It calls Honcho's dialectic
 *   `peer.chat()`, so the single `MemoryFact` it yields is natural-language reasoning about
 *   the user with a hard-coded `score` of `1.0`. `k` is not a result count: any `k >= 1` returns
 *   at most one fact (asking for 10 gets you one), and an empty answer returns `[]`. It is not
 *   ignored outright, though — `k <= 0` short-circuits to `[]` before any request is made, and the
 *   default is `k = 1`. Do not read `score` as a relevance signal here — it is a constant.
 * - **`delete` always fails.** `@honcho-ai/sdk` v2 exposes no message-delete method, so the
 *   adapter throws `MemoryAdapterError(code: "invalid_input")` rather than silently succeeding.
 *   Treat Honcho memory as append-only.
 * - **`history` is unsupported** (`capabilities.history === false`).
 * - **Session isolation is by key composition.** Each write lands in the Honcho session
 *   `` `${ctx.userId}--${ctx.sessionId ?? "default"}` `` under the peer `ctx.userId`; two users
 *   who both omit `sessionId` therefore do NOT share a session.
 *
 * Trap: Honcho validates peer and session ids against `/^[a-zA-Z0-9_-]+$/`. A `userId` or
 * `sessionId` carrying a `:`, a space or a `.` makes the vendor throw a `ZodError`, which this
 * adapter cannot classify and reports as `MemoryAdapterError(code: "unknown")` — not
 * `"invalid_input"`. Sanitize identifiers before they reach `MemoryContext`.
 *
 * Errors are always `MemoryAdapterError` with `adapterId: "honcho"` and one of
 * `auth_failed` (401/403) | `rate_limited` (429) | `not_found` (404) | `network` |
 * `invalid_input` | `unknown`.
 *
 * @public
 */
export function honchoMemory(options: HonchoAdapterOptions): Plugin {
  return Plugin.create({
    name: "@theokit/memory-honcho",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new HonchoAdapter(options),
  });
}
