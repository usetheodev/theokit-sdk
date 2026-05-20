import { ConfigurationError } from "../../errors.js";
import { type FrontmatterValue, parseSimpleYaml } from "./yaml-frontmatter.js";

type StringFields = Record<string, string | undefined>;

/** Narrow a FrontmatterValue to string; non-strings + undefined → undefined. */
function asString(v: FrontmatterValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Coerce parser output to legacy string-only shape (skill schema is all-string). */
function toStringFields(raw: Record<string, FrontmatterValue | undefined>): StringFields {
  const out: StringFields = {};
  for (const [k, v] of Object.entries(raw)) out[k] = asString(v);
  return out;
}

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

function extractAndParseFrontmatter(raw: string, fallbackName: string): StringFields {
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
    return toStringFields(parseSimpleYaml(frontmatter));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigurationError(
      `Skill ${fallbackName} has malformed YAML frontmatter: ${detail}`,
      { code: "schema_invalid", cause },
    );
  }
}

function resolveName(fields: StringFields, fallbackName: string): string {
  if (hasContent(fields.name)) return fields.name;
  if (hasContent(fallbackName)) return fallbackName;
  throw new ConfigurationError("Skill at unknown path is missing required field: name", {
    code: "schema_invalid",
  });
}

function ensureRequiredFields(fields: StringFields, name: string): void {
  if (!hasContent(fields.description)) {
    throw new ConfigurationError(`Skill ${name} is missing required field: description`, {
      code: "schema_invalid",
    });
  }
}

function buildFrontmatter(fields: StringFields, name: string): SkillFrontmatter {
  const description = fields.description;
  if (description === undefined) {
    // ensureRequiredFields already threw; this is unreachable but satisfies TS
    throw new ConfigurationError(`Skill ${name} missing description`, { code: "schema_invalid" });
  }
  const result: SkillFrontmatter = { name, description };
  if (hasContent(fields.category)) result.category = fields.category;
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
