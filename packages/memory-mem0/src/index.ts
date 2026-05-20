/**
 * `@usetheo/memory-mem0` — Mem0 cloud memory adapter for @usetheo/sdk.
 *
 * Cloud-only per ADR D148. Wraps `mem0ai` `MemoryClient`. Unique
 * capability among `@usetheo/memory-*` adapters: `history(id)`.
 *
 * @public
 */

import type { Plugin } from "@usetheo/sdk";
import { definePlugin } from "@usetheo/sdk";

import { Mem0Adapter, type Mem0AdapterOptions } from "./adapter.js";

export type { Mem0AdapterOptions } from "./adapter.js";

/** Build a `Plugin { kind: "memory" }`. @public */
export function mem0Memory(options: Mem0AdapterOptions): Plugin {
  return definePlugin({
    name: "@usetheo/memory-mem0",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new Mem0Adapter(options),
  });
}
