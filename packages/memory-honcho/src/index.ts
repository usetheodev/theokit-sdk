/**
 * `@theokit/memory-honcho` — Honcho memory adapter for @theokit/sdk.
 *
 * @public
 */

import type { Plugin } from "@theokit/sdk";
import { definePlugin } from "@theokit/sdk";

import { HonchoAdapter, type HonchoAdapterOptions } from "./adapter.js";

export type { HonchoAdapterOptions } from "./adapter.js";

/**
 * Build a `Plugin { kind: "memory" }` ready to pass to
 * `Agent.create({ plugins: [...] })`.
 *
 * @public
 */
export function honchoMemory(options: HonchoAdapterOptions): Plugin {
  return definePlugin({
    name: "@theokit/memory-honcho",
    version: "0.1.0",
    kind: "memory",
    createProvider: () => new HonchoAdapter(options),
  });
}
