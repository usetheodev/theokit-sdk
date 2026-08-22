/**
 * `toJsonSchema` — the Zod v4 → JSON Schema adapter tool-injector.ts uses to
 * build the `inputSchema` a model sees for a synthesized `transfer_to_*`
 * tool. Every assertion below checks the *emitted schema*, not merely that
 * the call returned — a defect here is a silently wrong tool contract, not
 * a crash (B-137).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/internal/to-json-schema.js";

describe("toJsonSchema", () => {
  it("converts a flat object schema, marking optional fields as not-required", () => {
    const schema = z.object({
      reason: z.string().describe("Brief reason for the transfer"),
      priority: z.number().optional(),
    });

    expect(toJsonSchema(schema)).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief reason for the transfer" },
        priority: { type: "number" },
      },
      required: ["reason"],
      additionalProperties: false,
    });
  });

  it("recursively converts nested object and array schemas", () => {
    const schema = z.object({
      tags: z.array(z.string()),
      nested: z.object({ inner: z.boolean() }),
    });

    const result = toJsonSchema(schema);

    expect(result.properties).toEqual({
      tags: { type: "array", items: { type: "string" } },
      nested: {
        type: "object",
        properties: { inner: { type: "boolean" } },
        required: ["inner"],
        additionalProperties: false,
      },
    });
    expect(result.required).toEqual(["tags", "nested"]);
  });

  it("maps an enum to a string type with an enum array", () => {
    const schema = z.enum(["low", "medium", "high"]);

    expect(toJsonSchema(schema)).toMatchObject({
      type: "string",
      enum: ["low", "medium", "high"],
    });
  });

  it.each([
    [z.string(), "string"],
    [z.number(), "number"],
    [z.boolean(), "boolean"],
  ])("maps a primitive Zod type to its JSON Schema type", (schema, expectedType) => {
    expect(toJsonSchema(schema)).toMatchObject({ type: expectedType });
  });

  it("defaults to unrepresentable: 'any', degrading an unrepresentable type to an empty schema instead of throwing", () => {
    // Called with ONLY the schema arg — exercises the wrapper's own default
    // parameter, which overrides Zod's native default (which THROWS when
    // `unrepresentable` is omitted entirely — see the `throw` test below).
    const result = toJsonSchema(z.date());

    expect(result).toEqual({ $schema: "https://json-schema.org/draft/2020-12/schema" });
  });

  it("unrepresentable: 'throw' rejects an unrepresentable type with Zod's specific error", () => {
    expect(() => toJsonSchema(z.bigint(), { unrepresentable: "throw" })).toThrow(
      "BigInt cannot be represented in JSON Schema",
    );
  });

  it("unrepresentable: 'throw' still accepts a representable schema", () => {
    // The guard branch (`throw`) must not reject everything — a plain
    // string is representable and must pass through unharmed.
    expect(toJsonSchema(z.string(), { unrepresentable: "throw" })).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
    });
  });

  it("degrades a transform to an empty schema under the default 'any' option", () => {
    const schema = z.string().transform((s) => s.toUpperCase());

    expect(toJsonSchema(schema)).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
  });

  it("rejects a transform with Zod's specific error under unrepresentable: 'throw'", () => {
    const schema = z.string().transform((s) => s.toUpperCase());

    expect(() => toJsonSchema(schema, { unrepresentable: "throw" })).toThrow(
      "Transforms cannot be represented in JSON Schema",
    );
  });
});
