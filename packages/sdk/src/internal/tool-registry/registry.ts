/**
 * ToolRegistry — Layer 1 of the 3-layer tool surface (T2.1, ADR D102).
 *
 * Registration is central: every tool has a single entry here keyed by
 * `name`. Layer 2 (Toolset) decides exposure; Layer 3 (check-fn-cache)
 * decides availability. Each layer mutates independently.
 *
 * @internal
 */

import type { CustomTool } from "../../types/agent.js";

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string> | string;
  /** Optional toolset name this tool belongs to. */
  toolset?: string;
  /** Availability probe (Hermes pattern). Result TTL-cached for 30s. */
  checkFn?: () => boolean | Promise<boolean>;
  /** Hard env var dependencies — all must be present + non-empty. */
  requiresEnv?: ReadonlyArray<string>;
  /** UI hint for emoji-aware renderers. */
  emoji?: string;
  /** Result truncation cap. Default DEFAULT_CAP from result-cap.ts. */
  maxResultSizeChars?: number;
}

export class ToolRegistry {
  #entries = new Map<string, ToolEntry>();

  register(entry: ToolEntry): void {
    if (this.#entries.has(entry.name)) {
      throw new Error(`Tool "${entry.name}" already registered`);
    }
    this.#entries.set(entry.name, entry);
  }

  get(name: string): ToolEntry | undefined {
    return this.#entries.get(name);
  }

  list(): ToolEntry[] {
    return Array.from(this.#entries.values());
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Convert a `defineTool` output into a ToolEntry. */
  static fromCustomTool(custom: CustomTool, opts?: { toolset?: string }): ToolEntry {
    const entry: ToolEntry = {
      name: custom.name,
      description: custom.description,
      inputSchema: custom.inputSchema as Record<string, unknown>,
      handler: custom.handler as ToolEntry["handler"],
    };
    if (opts?.toolset !== undefined) entry.toolset = opts.toolset;
    return entry;
  }
}
