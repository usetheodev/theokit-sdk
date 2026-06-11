/**
 * `@theokit/memory-supermemory` — Supermemory memory adapter for @theokit/sdk.
 *
 * Usage:
 *
 * ```ts
 * import { Agent } from "@theokit/sdk";
 * import { supermemoryMemory } from "@theokit/memory-supermemory";
 *
 * const agent = await Agent.create({
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   model: { id: "openai/gpt-4o-mini" },
 *   local: {},
 *   plugins: [supermemoryMemory({ apiKey: process.env.SUPERMEMORY_API_KEY! })],
 *   memoryContext: { userId: "demo" },
 * });
 *
 * await agent.memory.write("User likes Brazilian jazz", { userId: "demo" });
 * const facts = await agent.memory.recall("music preferences", { userId: "demo" });
 * ```
 *
 * @public
 */

import type { Plugin } from "@theokit/sdk";
import { definePlugin } from "@theokit/sdk";

import { SupermemoryAdapter, type SupermemoryAdapterOptions } from "./adapter.js";

export type { SupermemoryAdapterOptions } from "./adapter.js";

/**
 * Build a `Plugin { kind: "memory" }` ready to pass to
 * `Agent.create({ plugins: [...] })`.
 *
 * @public
 */
export function supermemoryMemory(options: SupermemoryAdapterOptions): Plugin {
  return definePlugin({
    name: "@theokit/memory-supermemory",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new SupermemoryAdapter(options),
  });
}
