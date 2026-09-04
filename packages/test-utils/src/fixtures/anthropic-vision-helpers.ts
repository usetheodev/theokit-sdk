/**
 * Shared Anthropic Vision API test helpers.
 * Consolidates 224+ duplicated lines from anthropic-vision.test.ts (3 sites).
 * @internal
 */
export function buildVisionTestImage(overrides?: Partial<Record<string, unknown>>) {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "test_data" },
    ...overrides,
  };
}
