/**
 * Parser for `.theokit/rules/*.md` — theokit-native path-scoped rules,
 * mirroring Claude Code's `.claude/rules/`.
 *
 * Frontmatter fields:
 *  - `paths` — glob-pattern array (Claude Code parity: `.claude/rules` uses `paths:`).
 *  - `globs` — glob-pattern array (Cursor-compatible alias; unioned with `paths`).
 *  - `alwaysApply` — activate unconditionally (no scope needed).
 *  - `enabled` — set `false` to disable the rule entirely (wins over everything).
 *  - `description` — human note; not used for activation in v1.
 *
 * Activation (`shouldActivateRule`):
 *  - `enabled: false` → never activates.
 *  - `alwaysApply: true` → always activates.
 *  - otherwise → activates iff a `paths`/`globs` pattern matches an in-scope
 *    file (the caller's `agent.send(..., { contextPaths })`). With no in-scope
 *    files, a scoped rule stays dormant (parity with Cursor `.mdc`).
 *
 * A file with no `---` frontmatter is treated as an unconditional rule
 * (`alwaysApply: true`). Malformed YAML → `undefined` (caller drops + counts).
 *
 * Glob + YAML subset are shared with the MDC parser (DRY, no new dependency).
 *
 * @internal
 */

import { z } from "zod";

import { anyGlobMatches } from "./context-glob.js";
import { parseSimpleYaml, splitFrontmatter } from "./context-yaml-lite.js";

/** YAML frontmatter schema for `.theokit/rules/*.md` files. @internal */
export const RulesFrontmatterSchema = z.object({
  description: z.string().optional(),
  paths: z.array(z.string()).optional(),
  globs: z.array(z.string()).optional(),
  alwaysApply: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export type RulesFrontmatter = z.infer<typeof RulesFrontmatterSchema>;

export interface RulesParseResult {
  readonly frontmatter: RulesFrontmatter;
  readonly body: string;
}

/**
 * Parse `.theokit/rules/*.md` content into frontmatter + body. No frontmatter
 * fence → unconditional rule. Malformed YAML → `undefined`.
 *
 * @internal
 */
export function parseRules(content: string): RulesParseResult | undefined {
  const { yaml, body } = splitFrontmatter(content);
  if (yaml === undefined) {
    return { frontmatter: { alwaysApply: true }, body: content };
  }
  try {
    const parsed = parseSimpleYaml(yaml);
    const validated = RulesFrontmatterSchema.safeParse(parsed);
    if (!validated.success) return undefined;
    return { frontmatter: validated.data, body };
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a rule activates given the in-scope files. `paths` and
 * `globs` are unioned; both are glob patterns matched against the caller's
 * declared scope.
 *
 * @internal
 */
export function shouldActivateRule(
  fm: RulesFrontmatter,
  inScopePaths: ReadonlyArray<string>,
): boolean {
  if (fm.enabled === false) return false;
  if (fm.alwaysApply === true) return true;
  const patterns = [...(fm.paths ?? []), ...(fm.globs ?? [])];
  if (patterns.length === 0) return false;
  return anyGlobMatches(patterns, inScopePaths);
}
