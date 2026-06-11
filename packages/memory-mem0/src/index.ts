/**
 * `@theokit/memory-mem0` — Mem0 cloud memory adapter for @theokit/sdk.
 *
 * Cloud-only per ADR D148. Wraps `mem0ai` `MemoryClient`. Unique
 * capability among `@theokit/memory-*` adapters: `history(id)`.
 *
 * @public
 */

import type { Plugin } from "@theokit/sdk";
import { definePlugin } from "@theokit/sdk";

import { Mem0Adapter, type Mem0AdapterOptions } from "./adapter.js";

export type { Mem0AdapterOptions } from "./adapter.js";

/** Build a `Plugin { kind: "memory" }`. @public */
export function mem0Memory(options: Mem0AdapterOptions): Plugin {
  return definePlugin({
    name: "@theokit/memory-mem0",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new Mem0Adapter(options),
  });
}
