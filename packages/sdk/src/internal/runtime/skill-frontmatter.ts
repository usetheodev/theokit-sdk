import { ConfigurationError } from "../../errors.js";
import { parseSimpleYaml } from "./yaml-frontmatter.js";

/**
 * Strict skill frontmatter schema (ADR D10).
 *
 * Required: `name`, `description`.
 * Optional: `category`, `dependencies` (comma-separated string in the
 * simple-YAML dialect — parsed to `string[]`).
 *
 * Unknown fields are ignored (forward-compat). Malformed YAML or missing
 * required fields surface as `ConfigurationError` with one of the typed
 * codes below.
 *
 * @internal
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  category?: string;
  dependencies?: string[];
}

export type SkillFrontmatterErrorCode = "missing_frontmatter" | "schema_invalid";

/**
 * Parse a SKILL.md file body into validated frontmatter.
 *
 * @throws ConfigurationError(code: "missing_frontmatter") — no `---` block at file head.
 * @throws ConfigurationError(code: "schema_invalid") — YAML malformed OR required field missing.
 *
 * @internal
 */
export function parseSkillFrontmatter(raw: string, fallbackName: string): SkillFrontmatter {
  const fields = extractAndParseFrontmatter(raw, fallbackName);
  const name = resolveName(fields, fallbackName);
  ensureRequiredFields(fields, name);
  return buildFrontmatter(fields, name);
}

function extractAndParseFrontmatter(raw: string, fallbackName: string): Record<string, string> {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(raw);
  if (match === null) {
    throw new ConfigurationError(`Skill ${fallbackName} is missing frontmatter`, {
      code: "missing_frontmatter",
    });
  }
  const frontmatter = match[1] ?? "";
  // EC-5: guard against syntactically invalid frontmatter so the loader
  // surfaces schema_invalid rather than crashing.
  try {
    return parseSimpleYaml(frontmatter);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigurationError(
      `Skill ${fallbackName} has malformed YAML frontmatter: ${detail}`,
      { code: "schema_invalid", cause },
    );
  }
}

function resolveName(fields: Record<string, string>, fallbackName: string): string {
  if (hasContent(fields.name)) return fields.name as string;
  if (hasContent(fallbackName)) return fallbackName;
  throw new ConfigurationError("Skill at unknown path is missing required field: name", {
    code: "schema_invalid",
  });
}

function ensureRequiredFields(fields: Record<string, string>, name: string): void {
  if (!hasContent(fields.description)) {
    throw new ConfigurationError(`Skill ${name} is missing required field: description`, {
      code: "schema_invalid",
    });
  }
}

function buildFrontmatter(fields: Record<string, string>, name: string): SkillFrontmatter {
  const result: SkillFrontmatter = {
    name,
    description: fields.description as string,
  };
  if (hasContent(fields.category)) result.category = fields.category as string;
  const deps = parseDependencies(fields.dependencies);
  if (deps !== undefined) result.dependencies = deps;
  return result;
}

function parseDependencies(raw: string | undefined): string[] | undefined {
  if (!hasContent(raw)) return undefined;
  const deps = (raw as string)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return deps.length > 0 ? deps : undefined;
}

function hasContent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
