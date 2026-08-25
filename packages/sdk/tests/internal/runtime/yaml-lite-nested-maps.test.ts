import { expect, it } from "vitest";
import { parseSimpleYaml } from "../../../src/internal/runtime/context/context-yaml-lite.js";

/*
 * A nested map was not merely unsupported — it was CORRUPTED.
 *
 * `metadata:` followed by indented `type: reference` took the "possible array" branch, collected
 * zero `- item` lines, and set `metadata: []`. The indented lines then parsed as ordinary top-level
 * entries, so the nesting silently flattened:
 *
 *   {"name":"foo","metadata":[],"type":"reference","modified":"…"}
 *
 * A caller reading `metadata.type` gets `undefined` and a caller reading `type` gets a value that
 * was never at the top level. Both are wrong, and neither throws.
 *
 * This matters now because Claude Code's memory files carry exactly that shape — `type` and
 * `modified` live under `metadata:` — and `@theokit/sdk` writes the formats Claude Code reads.
 */

it("parses a nested map instead of flattening it", () => {
  const out = parseSimpleYaml(
    ["name: foo", "description: bar", "metadata:", "  type: reference", "  node_type: memory"].join(
      "\n",
    ),
  );

  expect(out.metadata).toEqual({ type: "reference", node_type: "memory" });
  expect(out).not.toHaveProperty("type");
  expect(out.name).toBe("foo");
});

it("keeps scalars, inline arrays and multi-line arrays working", () => {
  // The accepted cases (`testing.md` § 4.2). This parser is shared with the `.cursor/rules/*.mdc`
  // and `.theokit/rules/*.md` loaders; a nesting change that broke a `paths:` list would take the
  // rule files with it.
  const out = parseSimpleYaml(
    [
      "alwaysApply: true",
      "limit: 42",
      'globs: ["**/*.ts", "**/*.tsx"]',
      "paths:",
      "  - src/api/**",
      "  - lib/**",
    ].join("\n"),
  );

  expect(out).toEqual({
    alwaysApply: true,
    limit: 42,
    globs: ["**/*.ts", "**/*.tsx"],
    paths: ["src/api/**", "lib/**"],
  });
});

it("still reports an empty key with nothing under it as an empty list", () => {
  // The pre-existing contract for `paths:` with no entries. A nested-map reader that claimed this
  // was `{}` would change what every rule file means.
  expect(parseSimpleYaml("paths:\nother: x")).toEqual({ paths: [], other: "x" });
});

it("still throws on a line that is not a key at all", () => {
  expect(() => parseSimpleYaml("just some prose")).toThrow(/Invalid YAML/);
});
