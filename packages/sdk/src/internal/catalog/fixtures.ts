import type { SDKProvider } from "../../types/providers.js";
import type { SDKModel, SDKRepository, SDKUser } from "../../types/theokit.js";

/**
 * Fixture catalog data — returned when fixture-mode is active (no
 * `THEOKIT_API_BASE_URL` set + `theo_test_*` API key).
 *
 * Shapes here must match the JSON files under `tests/golden/theokit/`
 * after `normalizeForGolden()` is applied. `createdAt` is an ISO timestamp
 * normalized to `<timestamp>` by the test helper.
 *
 * @internal
 */

const FIXTURE_TIMESTAMP = "2024-01-01T00:00:00.000Z";

/** Fixture user identity (matches `tests/golden/theokit/me.json`). */
export const FIXTURE_USER: SDKUser = {
  apiKeyName: "Contract Test Key",
  userEmail: "sdk-contract@example.com",
  createdAt: FIXTURE_TIMESTAMP,
};

/** Fixture model catalog (matches `tests/golden/theokit/models.json`). */
export const FIXTURE_MODELS: SDKModel[] = [
  {
    id: "composer-2",
    displayName: "Composer 2",
    parameters: [
      {
        id: "thinking",
        displayName: "Thinking",
        values: [
          { value: "low", displayName: "Low" },
          { value: "high", displayName: "High" },
        ],
      },
    ],
    variants: [
      {
        displayName: "High thinking",
        params: [{ id: "thinking", value: "high" }],
        isDefault: false,
      },
    ],
  },
];

/** Fixture connected repos (matches `tests/golden/theokit/repositories.json`). */
export const FIXTURE_REPOSITORIES: SDKRepository[] = [
  { url: "https://github.com/usetheo/example" },
];

/**
 * Fixture provider catalog. Covers chat, web_search, image, and embedding
 * capabilities. The `setupSchema` is intentionally generic JSON Schema —
 * consumers drive UI from these definitions.
 *
 * Public and secret-free by design — no tokens or API key examples.
 */
export const FIXTURE_PROVIDERS: SDKProvider[] = [
  {
    name: "anthropic",
    displayName: "Anthropic",
    capabilities: ["chat"],
    isAvailable: true,
    setupSchema: {
      type: "object",
      required: ["ANTHROPIC_API_KEY"],
      properties: { ANTHROPIC_API_KEY: { type: "string" } },
    },
  },
  {
    name: "openai",
    displayName: "OpenAI",
    capabilities: ["chat", "embedding", "image"],
    isAvailable: false,
    setupSchema: {
      type: "object",
      required: ["OPENAI_API_KEY"],
      properties: { OPENAI_API_KEY: { type: "string" } },
    },
  },
  {
    name: "openrouter",
    displayName: "OpenRouter",
    capabilities: ["chat"],
    isAvailable: true,
    setupSchema: {
      type: "object",
      required: ["OPENROUTER_API_KEY"],
      properties: { OPENROUTER_API_KEY: { type: "string" } },
    },
  },
  {
    name: "nous",
    displayName: "Nous Research",
    capabilities: ["chat"],
    isAvailable: true,
    setupSchema: {
      type: "object",
      required: ["NOUS_API_KEY"],
      properties: { NOUS_API_KEY: { type: "string" } },
    },
  },
  {
    name: "fixture-search",
    displayName: "Fixture Search",
    capabilities: ["web_search"],
    isAvailable: true,
    setupSchema: {
      type: "object",
      required: ["FIXTURE_SEARCH_TOKEN"],
      properties: { FIXTURE_SEARCH_TOKEN: { type: "string" } },
    },
  },
];
