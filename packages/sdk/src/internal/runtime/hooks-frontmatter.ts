/**
 * Hook frontmatter schema (ADR D76 — mirrors D10 SkillFrontmatter pattern).
 *
 * Used by the markdown hooks loader (`hooks/<name>.md`). Each .md file
 * represents one hook entry with structured frontmatter + optional prose
 * body explaining rationale.
 *
 * @internal
 */

import { z } from "zod";

import { ConfigurationError } from "../../errors.js";

/** Hook events supported by the SDK runtime. Mirrors HookEvent in hooks-executor.ts. */
export const HOOK_EVENTS = ["preRun", "postRun", "preToolUse", "postToolUse", "stop"] as const;

export const HookFrontmatterSchema = z.object({
  /** Lifecycle event the hook subscribes to. */
  event: z.enum(HOOK_EVENTS),
  /** Regex source compiled at exec time; restricts the hook to matching
   *  tool names (preToolUse/postToolUse) or other names (other events). */
  matcher: z.string().min(1),
  /** Shell command to spawn; receives the hook payload on stdin. */
  command: z.string().min(1),
  /** Disabled hooks are skipped at exec time (rename `.md.disabled` also works). */
  enabled: z.boolean().optional().default(true),
  /** Lower = runs first when multiple hooks match the same event/matcher. */
  priority: z.number().int().optional().default(0),
  /** Optional command timeout in ms; defaults to 30s downstream. */
  timeoutMs: z.number().int().positive().optional(),
});

export type HookFrontmatter = z.infer<typeof HookFrontmatterSchema>;

/**
 * Parse + validate hook frontmatter from a raw `Record<string, ...>` (output
 * of `parseSimpleYaml`). Wraps Zod errors in `ConfigurationError` with the
 * `hook_frontmatter_invalid` code so callers can pattern-match.
 *
 * @throws ConfigurationError(code: "hook_frontmatter_invalid")
 *
 * @internal
 */
export function parseHookFrontmatter(
  fields: Record<string, unknown>,
  slug: string,
): HookFrontmatter {
  const parsed = HookFrontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid hook frontmatter for "${slug}": ${parsed.error.message}`,
      { code: "hook_frontmatter_invalid" },
    );
  }
  return parsed.data;
}
