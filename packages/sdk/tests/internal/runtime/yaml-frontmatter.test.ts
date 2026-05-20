/**
 * Tests for parseSimpleYaml extended scalar + list support (T0.1).
 *
 * 10 cases per plan: 9 base + EC-3 empty-value.
 */

import { describe, expect, it } from "vitest";

import { parseSimpleYaml } from "../../../src/internal/runtime/yaml-frontmatter.js";

describe("parseSimpleYaml — scalar types", () => {
  it("strings stay strings (backward compat)", () => {
    expect(parseSimpleYaml("foo: bar")).toEqual({ foo: "bar" });
  });

  it("integer values coerce to number", () => {
    expect(parseSimpleYaml("priority: 1")).toEqual({ priority: 1 });
  });

  it("float values coerce to number", () => {
    expect(parseSimpleYaml("priority: 1.5")).toEqual({ priority: 1.5 });
  });

  it("true literal coerces to boolean", () => {
    expect(parseSimpleYaml("enabled: true")).toEqual({ enabled: true });
  });

  it("false literal coerces to boolean", () => {
    expect(parseSimpleYaml("enabled: false")).toEqual({ enabled: false });
  });

  it("ambiguous numeric-string keeps number (number wins)", () => {
    expect(parseSimpleYaml("name: 123")).toEqual({ name: 123 });
  });
});

describe("parseSimpleYaml — list values", () => {
  it("bracketed list of strings", () => {
    expect(parseSimpleYaml("tags: [a, b, c]")).toEqual({ tags: ["a", "b", "c"] });
  });

  it("empty list returns []", () => {
    expect(parseSimpleYaml("tags: []")).toEqual({ tags: [] });
  });

  it("comma in free-form string (no brackets) stays as single string", () => {
    expect(parseSimpleYaml("description: long, comma, prose")).toEqual({
      description: "long, comma, prose",
    });
  });
});

describe("parseSimpleYaml — empty value (EC-3 fix)", () => {
  it("empty value → undefined so Zod default kicks in", () => {
    expect(parseSimpleYaml("enabled:")).toEqual({ enabled: undefined });
  });
});

describe("parseSimpleYaml — backward compat for skills", () => {
  it("simple SKILL.md frontmatter still parses as strings", () => {
    const text = "name: morning-routine\ndescription: Generate a morning routine";
    expect(parseSimpleYaml(text)).toEqual({
      name: "morning-routine",
      description: "Generate a morning routine",
    });
  });
});
