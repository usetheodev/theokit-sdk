import { Plugin } from "@theokit/sdk";

import { SupermemoryAdapter, type SupermemoryAdapterOptions } from "./adapter.js";

export type { SupermemoryAdapterOptions } from "./adapter.js";

/**
 * Build a `Plugin { kind: "memory" }` ready to pass to
 * `Agent.create({ plugins: [...] })`.
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
