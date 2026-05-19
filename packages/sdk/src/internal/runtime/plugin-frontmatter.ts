/**
 * Plugin manifest frontmatter schema (ADR D76).
 *
 * Used by the markdown plugin loader (`plugins/<name>/PLUGIN.md`). Matches
 * the legacy `plugin.json` shape consumed by `plugins-manager.ts`:
 * `{ name, version, capabilities, entry }`. Frontmatter is flat — no
 * nested provider object (parseSimpleYaml doesn't support nesting).
 *
 * @internal
 */

import { z } from "zod";

import { ConfigurationError } from "../../errors.js";

export const PluginFrontmatterSchema = z.object({
  /** Plugin identifier; defaults to folder name if omitted. */
  name: z.string().min(1).optional(),
  /** SemVer string; defaults to "0.0.0" if omitted. */
  version: z.string().optional(),
  /** What this plugin provides. */
  capabilities: z.array(z.string()).optional(),
  /** Relative path to the JS entry file within the plugin folder. */
  entry: z.string().min(1).optional(),
});

export type PluginFrontmatter = z.infer<typeof PluginFrontmatterSchema>;

/**
 * @throws ConfigurationError(code: "plugin_frontmatter_invalid")
 * @internal
 */
export function parsePluginFrontmatter(
  fields: Record<string, unknown>,
  slug: string,
): PluginFrontmatter {
  const parsed = PluginFrontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid plugin frontmatter for "${slug}": ${parsed.error.message}`,
      { code: "plugin_frontmatter_invalid" },
    );
  }
  return parsed.data;
}
