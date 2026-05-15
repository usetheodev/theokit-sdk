/**
 * Tiny YAML-frontmatter parser shared by the file-based loaders (skills,
 * subagents, …). Only supports the `key: value` shape — no nested objects,
 * arrays, or quoted strings. Sufficient for the SDK's `.theokit/` files.
 *
 * @internal
 */
export function parseSimpleYaml(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key.length > 0) fields[key] = value;
  }
  return fields;
}
