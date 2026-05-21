/**
 * Personality preset types + Zod frontmatter schema (T1.1, ADR D161).
 *
 * **EC-C:** name regex is **lowercase-only** (NO `/i` flag) to prevent
 * `Coder` vs `coder` becoming distinct registry keys (Map verbatim).
 * Forcing lowercase eliminates the ambiguity at validation time.
 *
 * @internal
 */

import { z } from "zod";

/**
 * Frontmatter schema for `.theokit/personalities/*.md` files.
 *
 * @internal
 */
export const PersonalityFrontmatterSchema = z.object({
  // EC-C: lowercase-only — prevents Coder vs coder ambiguity in registry Map keys.
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "Personality name must be a lowercase slug (a-z, 0-9, _, -)"),
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type PersonalityFrontmatter = z.infer<typeof PersonalityFrontmatterSchema>;

/**
 * Resolved personality preset — frontmatter + body + source provenance.
 * Defined publicly in `types/agent.ts` so the DTS bundle never crosses
 * `internal/`. Re-exported here for ergonomic internal callers.
 *
 * @public
 */
export type { PersonalityPreset } from "../../types/agent.js";

/** Reserved slugs that map to "clear active preset". @internal */
export const RESERVED_CLEAR_SLUGS = ["none", "default", "neutral"] as const;
