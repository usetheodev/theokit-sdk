import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigurationError } from "../../src/errors.js";
import { normalizeSchema } from "../../src/schema-normalizer.js";

/**
 * M23 — schema normalizer, one golden case per provider. Zod is the default; JSON Schema passes
 * through; ArkType uses its own `.toJsonSchema()`; Valibot (no optional peer installed here) fails
 * with a clear install message. Parse-failure handling stays uniform downstream.
 */

describe("M23 — normalizeSchema", () => {
  it("Zod (default) → JSON Schema with the declared properties", async () => {
    const out = await normalizeSchema(z.object({ name: z.string(), age: z.number() }));
    expect(out.type).toBe("object");
    expect(Object.keys(out.properties as Record<string, unknown>)).toEqual(["name", "age"]);
  });

  it("JSON Schema → passthrough (unchanged)", async () => {
    const js = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    expect(await normalizeSchema(js)).toBe(js);
  });

  it("ArkType-style (.toJsonSchema()) → delegates to the schema's own method", async () => {
    const arkLike = {
      // ArkType 2.0 types expose `.toJsonSchema()`.
      toJsonSchema: () => ({ type: "object", properties: { city: { type: "string" } } }),
    };
    const out = await normalizeSchema(arkLike);
    expect(out).toEqual({ type: "object", properties: { city: { type: "string" } } });
  });

  it("Valibot without the optional peer → clear install error", async () => {
    // A minimal valibot-shaped schema; @valibot/to-json-schema is not installed in this repo.
    const valibotLike = { kind: "schema", type: "object", entries: {} };
    await expect(normalizeSchema(valibotLike)).rejects.toThrow(/@valibot\/to-json-schema/);
  });

  it("unsupported input → clear error listing the supported providers", async () => {
    await expect(normalizeSchema(42)).rejects.toThrow(/unsupported schema/i);
  });

  /**
   * `normalizeSchema` is public — re-exported from the root barrel — and both of its failures used to
   * be bare `Error`. A consumer could branch on nothing but the sentence, in a package whose whole
   * error design is "decide retryability at construction and give the caller a code".
   *
   * Asserting the message is not enough and was what let the bare throws survive: a message regex
   * passes for `Error`, for `TypeError`, for anything. These assert the TYPE and the CODE.
   */
  it("the missing-peer failure is typed and coded, not a bare Error", async () => {
    const valibotLike = { kind: "schema", type: "object", entries: {} };
    await expect(normalizeSchema(valibotLike)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "valibot_converter_missing",
      isRetryable: false,
    });
    await expect(normalizeSchema(valibotLike)).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("the unsupported-schema failure is typed and coded, not a bare Error", async () => {
    await expect(normalizeSchema(42)).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "unsupported_schema",
      isRetryable: false,
    });
    await expect(normalizeSchema(42)).rejects.toBeInstanceOf(ConfigurationError);
  });
});
