/**
 * MDC (Markdown Cursor) parser for `.cursor/rules/*.mdc` (T3.1, ADR D154).
 *
 * Parses YAML frontmatter with `description` / `globs` / `alwaysApply`
 * fields. Honors activation per Cursor's docs:
 *  - `alwaysApply: true` → activates unconditionally.
 *  - `alwaysApply: false` + matching glob in `touchedFiles` → activates.
 *  - `alwaysApply: false` + no glob match → skipped.
 *
 * **EC-I (v1 semantic):** at `agent.send()` time, `touchedFiles` is
 * empty. Only `alwaysApply: true` rules activate. Per-glob activation
 * arrives in v2 when we hook the file-read pipeline. Description-based
 * "agent requested" classification is out of scope.
 *
 * Glob matching uses a tiny in-house `*` → `.*` regex (no new dep)
 * sufficient for the patterns Cursor itself recommends.
 *
 * @internal
 */

import { z } from "zod";

/** YAML frontmatter schema for MDC files. @internal */
export const McdFrontmatterSchema = z.object({
  description: z.string().optional(),
  globs: z.array(z.string()).optional(),
  alwaysApply: z.boolean().optional(),
});

export type McdFrontmatter = z.infer<typeof McdFrontmatterSchema>;

export interface McdParseResult {
  readonly frontmatter: McdFrontmatter;
  readonly body: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

/**
 * Parse `.mdc` content. Returns frontmatter + body. EC-18: when the
 * file has no `---` frontmatter, returns `frontmatter: {alwaysApply:
 * true}` so the body is treated as an unconditional rule.
 *
 * On YAML parse error, returns `undefined` and the caller emits a
 * telemetry counter (EC-21).
 *
 * @internal
 */
export function parseMdc(content: string): McdParseResult | undefined {
  const m = FRONTMATTER_RE.exec(content);
  if (m === null) {
    // EC-18: no frontmatter — treat as alwaysApply
    return { frontmatter: { alwaysApply: true }, body: content };
  }
  const yamlBody = m[1] ?? "";
  const body = m[2] ?? "";
  try {
    const parsed = parseSimpleYaml(yamlBody);
    const validated = McdFrontmatterSchema.safeParse(parsed);
    if (!validated.success) return undefined;
    return { frontmatter: validated.data, body };
  } catch {
    return undefined;
  }
}

/**
 * Decide whether an MDC rule activates given the currently-touched
 * files. EC-I: empty `touchedFiles` → only `alwaysApply: true`
 * activates.
 *
 * @internal
 */
export function shouldActivate(fm: McdFrontmatter, touchedFiles: ReadonlyArray<string>): boolean {
  if (fm.alwaysApply === true) return true;
  if (fm.globs === undefined || fm.globs.length === 0) return false;
  if (touchedFiles.length === 0) return false;
  const globRes = fm.globs.map(globToRegex);
  return touchedFiles.some((file) => globRes.some((re) => re.test(file)));
}

function globToRegex(glob: string): RegExp {
  // Support **, *, ?. Escape other regex metas.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Minimal YAML subset parser — handles `key: value` lines (string
 * scalars, booleans, integers) and `key:` followed by `- item` arrays.
 * Sufficient for MDC frontmatter (3 known fields). Throws on truly
 * malformed input.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: YAML-subset parser handles scalars + multi-line arrays + inline arrays in a single pass; extracting helpers fragments the line-state machine.
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) throw new Error(`Invalid YAML line: ${trimmed}`);
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    if (rest === "") {
      // Possible array; collect indented `- item` lines.
      const items: string[] = [];
      while (i < lines.length) {
        const next = lines[i];
        if (next === undefined) break;
        const nextTrim = next.trim();
        if (nextTrim.startsWith("- ")) {
          items.push(parseScalar(nextTrim.slice(2).trim()) as string);
          i += 1;
        } else if (nextTrim === "") {
          i += 1;
        } else {
          break;
        }
      }
      out[key] = items;
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      // Inline array `globs: ["**/*.ts", "**/*.tsx"]`
      const inner = rest.slice(1, -1).trim();
      out[key] =
        inner === ""
          ? []
          : inner.split(",").map((s) => parseScalar(s.trim().replace(/^["']|["']$/g, "")));
    } else {
      out[key] = parseScalar(rest);
    }
  }
  return out;
}

function parseScalar(s: string): string | boolean | number {
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  // Strip surrounding quotes if present.
  return s.replace(/^["']|["']$/g, "");
}
