import { Plugin } from "@theokit/sdk";

import { Mem0Adapter, type Mem0AdapterOptions } from "./adapter.js";

export type { Mem0AdapterOptions } from "./adapter.js";

/** Build a `Plugin { kind: "memory" }`. @public */
export function mem0Memory(options: Mem0AdapterOptions): Plugin {
  return Plugin.create({
    name: "@theokit/memory-mem0",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new Mem0Adapter(options),
  });
}
