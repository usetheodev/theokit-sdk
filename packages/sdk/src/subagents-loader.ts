/**
 * M81 — `.theokit/agents` discovery, exposed so a consumer can read the on-disk subagent
 * definitions with one import instead of hand-rolling a second parser.
 *
 * ## Why this file exists
 *
 * `src/skills.ts` already exposed `discoverSkills` for the sibling domain. Subagents had the same
 * loader — `internal/runtime/skills/subagents-loader.ts` — with no public door. A consumer behind
 * the layer boundary (the agent-builder never imports `@theokit/sdk*` directly) could not reach it,
 * so re-implementing was the only legal option. It re-implemented, and then wrote a test whose only
 * job was to watch the two parsers for drift. That test is the cleanest possible evidence that the
 * duplication should not exist.
 *
 * ## What crosses is the PARSED config
 *
 * The return is `AgentDefinition` — already interpreted — never the `.md` text or the frontmatter
 * shape. Exporting the file format would freeze an internal detail as public API; exporting the
 * parsed value leaves the format free to change.
 */

import { loadSubagents } from "./internal/runtime/skills/subagents-loader.js";
import type { AgentDefinition } from "./types/agent.js";

/**
 * Discover the subagents defined under `<cwd>/.theokit/agents/*.md`.
 *
 * An absent directory yields `{}` — a project without subagents is the common case, not an error.
 */
export async function discoverSubagents(cwd: string): Promise<Record<string, AgentDefinition>> {
  return loadSubagents(cwd, true, undefined);
}

/**
 * Load ONE subagent definition by name, or `undefined` when it is not defined on disk.
 *
 * A thin selector over {@link discoverSubagents} rather than a second reader: one parser is the
 * whole point of this module.
 */
export async function loadSubagentDefinition(
  name: string,
  cwd: string,
): Promise<AgentDefinition | undefined> {
  return (await discoverSubagents(cwd))[name];
}
