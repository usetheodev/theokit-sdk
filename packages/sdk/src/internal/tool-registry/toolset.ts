/**
 * Toolset — Layer 2 of the 3-layer tool surface (T2.2, ADR D104).
 *
 * Named flat list of tool names. No `extends` (composition ambiguity).
 * `resolveToolset` drops missing tools silently; `resolveToolsetStrict`
 * throws — caller picks.
 *
 * @internal
 */

import type { ToolEntry, ToolRegistry } from "./registry.js";

export interface Toolset {
  name: string;
  tools: ReadonlyArray<string>;
}

export const CORE_TOOLSET: Toolset = {
  name: "core",
  tools: ["shell", "read_file", "write_file", "memory_search", "memory_get"],
};

export function resolveToolset(toolset: Toolset, registry: ToolRegistry): ToolEntry[] {
  // EC-7: duplicates in `toolset.tools` are preserved (caller dedup
  // responsibility). Returning the same ref twice is idempotent in
  // downstream filters.
  return toolset.tools
    .map((name) => registry.get(name))
    .filter((e): e is ToolEntry => e !== undefined);
}

export function resolveToolsetStrict(toolset: Toolset, registry: ToolRegistry): ToolEntry[] {
  return toolset.tools.map((name) => {
    const entry = registry.get(name);
    if (entry === undefined) {
      throw new Error(`Toolset "${toolset.name}" references unknown tool "${name}"`);
    }
    return entry;
  });
}
