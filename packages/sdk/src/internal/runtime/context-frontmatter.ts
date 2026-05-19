/**
 * Context source frontmatter schema (ADR D76 — mirrors D10 / hooks-frontmatter).
 *
 * Used by the markdown context loader (`context/<name>.md`). Each .md file
 * represents one context source with structured frontmatter + optional
 * prose body explaining why this source is part of the agent's context.
 *
 * @internal
 */

import { z } from "zod";

import { ConfigurationError } from "../../errors.js";

export const ContextSourceFrontmatterSchema = z.object({
  /** Identifier; defaults to filename slug if omitted. */
  name: z.string().min(1).optional(),
  /** File path relative to cwd. */
  path: z.string().min(1),
  /** Disabled sources excluded from the context snapshot. */
  enabled: z.boolean().optional().default(true),
  /** Optional per-source token budget. */
  maxTokens: z.number().int().positive().optional(),
});

export type ContextSourceFrontmatter = z.infer<typeof ContextSourceFrontmatterSchema>;

/**
 * @throws ConfigurationError(code: "context_frontmatter_invalid")
 * @internal
 */
export function parseContextSourceFrontmatter(
  fields: Record<string, unknown>,
  slug: string,
): ContextSourceFrontmatter {
  const parsed = ContextSourceFrontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid context source frontmatter for "${slug}": ${parsed.error.message}`,
      { code: "context_frontmatter_invalid" },
    );
  }
  return parsed.data;
}
