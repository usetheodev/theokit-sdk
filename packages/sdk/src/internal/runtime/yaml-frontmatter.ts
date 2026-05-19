/**
 * Tiny YAML-frontmatter parser shared by the file-based loaders (skills,
 * subagents, hooks, context, plugins). Supports four scalar shapes:
 *
 *   key: bar              → "bar"        (string)
 *   key: 42               → 42           (number)
 *   key: true             → true         (boolean)
 *   key: [a, b, c]        → ["a","b","c"](string[])
 *   key:                  → undefined    (caller's Zod default kicks in)
 *
 * Limitations (intentional — keep parser tiny, no dep):
 * - No nested objects (use flat keys like `providerId` not `provider.id`).
 * - No quoted strings — `match: "1"` becomes the literal 3-char string `"1"`.
 * - List values cannot contain a literal comma inside an element; the
 *   `tags: [a,b, c]` splitter is greedy on `,`. Use multi-line lists or
 *   reword if you need this.
 *
 * @internal
 */

export type FrontmatterValue = string | number | boolean | string[];

export function parseSimpleYaml(text: string): Record<string, FrontmatterValue | undefined> {
  const fields: Record<string, FrontmatterValue | undefined> = {};
  for (const line of text.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    if (key.length === 0) continue;
    const raw = line.slice(colonIndex + 1).trim();
    fields[key] = coerce(raw);
  }
  return fields;
}

function coerce(raw: string): FrontmatterValue | undefined {
  // EC-3: empty value → undefined so Zod `.optional().default(...)` applies.
  if (raw.length === 0) return undefined;
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (raw === "true" || raw === "false") return raw === "true";
  const n = Number(raw);
  if (Number.isFinite(n) && raw === String(n)) return n;
  return raw;
}
