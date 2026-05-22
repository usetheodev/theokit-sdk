import { AuthenticationError } from "./errors.js";
import {
  FIXTURE_MODELS,
  FIXTURE_PROVIDERS,
  FIXTURE_REPOSITORIES,
  FIXTURE_USER,
} from "./internal/catalog/fixtures.js";
import { listLocalModelsViaOpenAiCompat } from "./internal/catalog/local-models.js";
import { resolveApiKey } from "./internal/env.js";
import { isFixtureApiKey, shouldUseFixtureMode } from "./internal/fixture-mode.js";
import { httpRequest } from "./internal/http.js";
import { MEMORY_EMBEDDING_ADAPTERS } from "./internal/memory/adapters/catalog.js";
import {
  getProviderProfile,
  listProviders,
  registerBuiltins,
} from "./internal/providers/index.js";
import type { SDKProvider } from "./types/providers.js";
import type { SDKModel, SDKRepository, SDKUser } from "./types/theokit.js";

/**
 * Options shared by every `Theokit.*` request.
 *
 * @public
 */
export interface TheokitRequestOptions {
  /** Override the `THEOKIT_API_KEY` env var for this call. */
  apiKey?: string;
  /**
   * Target a specific provider for catalog reads. When set to a provider
   * with `authType: "none"` (e.g. `"ollama"`, `"lmstudio"`, `"llamacpp"`),
   * `Theokit.models.list({ provider })` reads from the provider's local
   * `/v1/models` endpoint instead of the TheoCloud catalog. ADR D184.
   *
   * @public
   */
  provider?: string;
}

/**
 * Account-level and catalog reads. All methods accept an optional `apiKey`
 * and otherwise fall back to the `THEOKIT_API_KEY` environment variable.
 *
 * @public
 */
export class Theokit {
  private constructor() {
    // Static-only namespace.
  }

  /**
   * Return the user behind the current API key.
   *
   * @public
   */
  static me(options: TheokitRequestOptions = {}): Promise<SDKUser> {
    return executeCatalogRequest({
      apiKey: options.apiKey,
      fixture: FIXTURE_USER,
      path: "/v1/me",
    });
  }

  /**
   * Model catalog reads.
   *
   * @public
   */
  static readonly models: {
    list: (options?: TheokitRequestOptions) => Promise<SDKModel[]>;
  } = {
    list: async (options = {}) => {
      // ADR D184: when `provider` targets an `authType: "none"` provider,
      // read locally instead of hitting TheoCloud. Cloud catalog path is
      // unchanged when `provider` is undefined.
      if (options.provider !== undefined) {
        const localModels = await maybeListLocalModels(options.provider);
        if (localModels !== undefined) return localModels;
      }
      return executeCatalogRequest({
        apiKey: options.apiKey,
        fixture: FIXTURE_MODELS,
        path: "/v1/models",
      });
    },
  };

  /**
   * Connected GitHub repositories for the calling user's team. Cloud only.
   *
   * @public
   */
  static readonly repositories: {
    list: (options?: TheokitRequestOptions) => Promise<SDKRepository[]>;
  } = {
    list: (options = {}) =>
      executeCatalogRequest({
        apiKey: options.apiKey,
        fixture: FIXTURE_REPOSITORIES,
        path: "/v1/repositories",
      }),
  };

  /**
   * Provider catalog. Lists every provider known to the platform, including
   * plugin-registered ones, with capability and availability metadata.
   *
   * @public
   */
  static readonly providers: {
    list: (options?: TheokitRequestOptions) => Promise<SDKProvider[]>;
  } = {
    list: (options = {}) =>
      executeCatalogRequest({
        apiKey: options.apiKey,
        fixture: FIXTURE_PROVIDERS,
        path: "/v1/providers",
      }),
  };

  /**
   * Local introspection of bundled SDK assets (ADR D201). Unlike the
   * cloud-catalog `providers.list()` (which hits the TheoCloud HTTP API),
   * `inspect.*` reads the SDK's own bundled registries — useful for
   * tooling (e.g. `@usetheo/cli`'s `theokit inspect`) that needs to know
   * what's available WITHOUT a network round-trip.
   *
   * @public
   */
  static readonly inspect: {
    builtinProviders: () => Array<{
      readonly name: string;
      readonly apiMode: string;
      readonly authType: string;
      readonly baseUrl: string;
      readonly aliases?: ReadonlyArray<string>;
      readonly envVars: ReadonlyArray<string>;
    }>;
    embeddingAdapters: () => Array<{
      readonly id: string;
      readonly transport: string;
      readonly defaultModel: string;
    }>;
  } = {
    builtinProviders: () => {
      registerBuiltins();
      return listProviders().map((p) => ({
        name: p.name,
        apiMode: p.apiMode,
        authType: p.authType,
        baseUrl: p.baseUrl,
        ...(p.aliases !== undefined ? { aliases: p.aliases } : {}),
        envVars: p.envVars,
      }));
    },
    embeddingAdapters: () =>
      Object.entries(MEMORY_EMBEDDING_ADAPTERS).map(([id, adapter]) => ({
        id,
        transport: adapter.transport,
        defaultModel: adapter.defaultModel,
      })),
  };
}

/**
 * ADR D184: when caller passed `{ provider }` targeting a profile with
 * `authType: "none"`, fetch from the local provider's `/v1/models`.
 * Returns `undefined` when the provider does not exist OR has auth —
 * caller falls back to the cloud catalog path.
 */
async function maybeListLocalModels(providerName: string): Promise<SDKModel[] | undefined> {
  registerBuiltins();
  const profile = getProviderProfile(providerName);
  if (profile === undefined) return undefined;
  if (profile.authType !== "none") return undefined;
  const baseUrl = resolveLocalProviderBaseUrl(profile.name, profile.baseUrl);
  return listLocalModelsViaOpenAiCompat(baseUrl);
}

function resolveLocalProviderBaseUrl(providerName: string, fallback: string): string {
  // Mirror the env override priority used in router.ts selectTransport.
  if (providerName === "ollama" && process.env.OLLAMA_HOST !== undefined) {
    return process.env.OLLAMA_HOST;
  }
  return fallback;
}

interface CatalogRequest<T> {
  apiKey: string | undefined;
  fixture: T;
  path: string;
}

async function executeCatalogRequest<T>(request: CatalogRequest<T>): Promise<T> {
  const apiKey = resolveApiKey(request.apiKey);
  if (apiKey === undefined) {
    throw new AuthenticationError("Missing API key", { code: "missing_api_key" });
  }

  if (shouldUseFixtureMode(apiKey)) {
    return request.fixture;
  }

  // Fixture-mode is off — either an explicit base URL is set (real HTTP)
  // or a non-fixture key is being used without a backend reachable.
  if (!isFixtureApiKey(apiKey) && process.env.THEOKIT_API_BASE_URL === undefined) {
    throw new AuthenticationError("Invalid API key", { code: "authentication_error" });
  }

  return httpRequest<T>(request.path, { apiKey });
}
