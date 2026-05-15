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
    name: "Composer 2",
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
 * Generic JSON Schema used as `setupSchema` for fixture providers. The
 * property name is intentionally generic (`credential`) so the schema never
 * contains substrings that look like environment variable names for real
 * provider tokens — fixture output must remain secret-shaped-noise-free.
 */
const GENERIC_SETUP_SCHEMA = {
  type: "object",
  description: "Configuration values for this provider.",
  required: ["credential"],
  properties: { credential: { type: "string" } },
} as const;

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
    setupSchema: GENERIC_SETUP_SCHEMA,
  },
  {
    name: "openai",
    displayName: "OpenAI",
    capabilities: ["chat", "embedding", "image"],
    isAvailable: false,
    setupSchema: GENERIC_SETUP_SCHEMA,
  },
  {
    name: "openrouter",
    displayName: "OpenRouter",
    capabilities: ["chat"],
    isAvailable: true,
    setupSchema: GENERIC_SETUP_SCHEMA,
  },
  {
    name: "nous",
    displayName: "Nous Research",
    capabilities: ["chat"],
    isAvailable: true,
    setupSchema: GENERIC_SETUP_SCHEMA,
  },
  {
    name: "fixture-search",
    displayName: "Fixture Search",
    capabilities: ["web_search"],
    isAvailable: true,
    setupSchema: GENERIC_SETUP_SCHEMA,
  },
];
