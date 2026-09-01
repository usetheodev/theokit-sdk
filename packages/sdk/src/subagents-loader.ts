/**
 * Published as `@theokit/sdk/subagents-loader`.
 *
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

import { ConfigurationError } from "./errors.js";
import { loadSubagents } from "./internal/runtime/skills/subagents-loader.js";
import type { AgentDefinition } from "./types/agent.js";

/**
 * The parsed subagent definition this module hands back.
 *
 * Re-exported here — beside the loader that produces it — so a consumer can NAME the value it
 * receives without reaching into `types/agent`, which no subpath publishes. A layer above may then
 * alias it (`AgentDefinition as SubagentDefinition`) to sidestep a name it has already spent.
 */
export type { AgentDefinition } from "./types/agent.js";

/**
 * Where subagent definitions may be read from. A closed union rather than a boolean: a third
 * source can join it without breaking the signature, and the call site reads as what it means.
 */
export type SubagentSource = "project";

const ACCEPTED_SOURCES: readonly SubagentSource[] = ["project"];

/** Options for {@link discoverSubagents} / {@link loadSubagentDefinition}. */
export interface DiscoverSubagentsOptions {
  /**
   * Which sources to read. Defaults to `["project"]` — `<cwd>/.theokit/agents/*.md`.
   *
   * An empty list reads NOTHING: the directory is never opened, so a caller that has not yet
   * established trust in `cwd` can decline the read rather than filter its result.
   */
  readonly settingSources?: readonly SubagentSource[];
}

// Validated at the boundary (error-handling.md § 2): the union is erased at runtime, so a JS
// caller — or a value crossing a serialization hop — can still carry a source nobody honors.
// Dropping it silently would read as "no subagents found", which is the same shape as success.
function resolveSources(options: DiscoverSubagentsOptions | undefined): readonly SubagentSource[] {
  const declared = options?.settingSources;
  if (declared === undefined) return ACCEPTED_SOURCES;
  for (const source of declared) {
    if (!ACCEPTED_SOURCES.includes(source)) {
      throw new ConfigurationError(
        `Unknown subagent setting source "${String(source)}" (accepted: ${ACCEPTED_SOURCES.join(", ")})`,
        { code: "subagent_unknown_setting_source" },
      );
    }
  }
  return declared;
}

/**
 * Discover the subagents defined under `<cwd>/.theokit/agents/*.md`.
 *
 * An absent directory yields `{}` — a project without subagents is the common case, not an error.
 */
export async function discoverSubagents(
  cwd: string,
  options?: DiscoverSubagentsOptions,
): Promise<Record<string, AgentDefinition>> {
  const sources = resolveSources(options);
  return loadSubagents(cwd, sources.includes("project"), undefined);
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
  options?: DiscoverSubagentsOptions,
): Promise<AgentDefinition | undefined> {
  return (await discoverSubagents(cwd, options))[name];
}
