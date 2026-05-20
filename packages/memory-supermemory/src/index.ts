/**
 * `@usetheo/memory-supermemory` — Supermemory memory adapter for @usetheo/sdk.
 *
 * Usage:
 *
 * ```ts
 * import { Agent } from "@usetheo/sdk";
 * import { supermemoryMemory } from "@usetheo/memory-supermemory";
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

import type { Plugin } from "@usetheo/sdk";
import { definePlugin } from "@usetheo/sdk";

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
    name: "@usetheo/memory-supermemory",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new SupermemoryAdapter(options),
  });
}
