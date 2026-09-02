import { describe, expect, it } from "vitest";
import { loadProviderCatalog } from "../../../src/internal/providers/catalog-loader.js";
import { catalogEntrySchema } from "../../../src/internal/providers/catalog-schema.js";

/**
 * The loader validated entries by hand: nine `typeof`/`Array.isArray` checks and then
 * `as unknown as CatalogEntry` for the whole object. Everything it did not check —
 * `capabilities`' contents, `aliases`, `modelsUrl`, `hostname`, `extraHeaders`, `models` — was
 * ASSERTED, in a module that already imports zod for the nested model schema forty lines below.
 *
 * These cases are the ones the hand-rolled check could not see. Each is a shape it accepted.
 */
describe("catalogEntrySchema rejects what the hand-rolled check waved through", () => {
  const valid = {
    id: "acme",
    displayName: "Acme",
    apiMode: "chat_completions",
    authType: "api_key",
    baseUrl: "https://api.acme.test/v1",
    envVars: ["ACME_API_KEY"],
    fallbackModels: ["acme/fast"],
    capabilities: {
      supportsToolUse: true,
      supportsVision: false,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      supportsCacheControl: false,
    },
  };

  it("accepts a well-formed entry", () => {
    expect(catalogEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("keeps unknown upstream keys instead of rejecting the entry", () => {
    // Loose by design, like catalogModelSchema beside it: the catalog is vendored data that
    // upstream extends, and additive drift must never break the loader.
    const parsed = catalogEntrySchema.safeParse({ ...valid, somethingNew: 42 });
    expect(parsed.success).toBe(true);
  });

  it("rejects an apiMode the SDK cannot dispatch", () => {
    // The old check was `typeof raw.apiMode !== "string"`, so this reached selectTransport as a
    // string matching no branch.
    expect(catalogEntrySchema.safeParse({ ...valid, apiMode: "grpc_streaming" }).success).toBe(
      false,
    );
  });

  it("rejects an authType outside the closed union", () => {
    expect(catalogEntrySchema.safeParse({ ...valid, authType: "basic_auth" }).success).toBe(false);
  });

  it("rejects capabilities whose flags are not booleans", () => {
    // `raw.capabilities == null || typeof raw.capabilities !== "object"` accepted `{}` and accepted
    // any garbage inside it.
    expect(catalogEntrySchema.safeParse({ ...valid, capabilities: {} }).success).toBe(false);
    expect(
      catalogEntrySchema.safeParse({
        ...valid,
        capabilities: { ...valid.capabilities, supportsToolUse: "yes" },
      }).success,
    ).toBe(false);
  });

  it("rejects envVars holding non-strings", () => {
    // `Array.isArray` says nothing about the contents.
    expect(catalogEntrySchema.safeParse({ ...valid, envVars: [1, 2] }).success).toBe(false);
  });

  it("rejects extraHeaders whose values are not strings", () => {
    expect(catalogEntrySchema.safeParse({ ...valid, extraHeaders: { "x-key": 7 } }).success).toBe(
      false,
    );
  });

  it("the REAL vendored catalog still parses — the schema is not stricter than the data", () => {
    const catalog = loadProviderCatalog();
    expect(
      Object.keys(catalog).length,
      "zero providers would mean the loader now rejects everything, which passes every check above",
    ).toBeGreaterThan(20);
  });
});
