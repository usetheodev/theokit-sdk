import { AuthenticationError } from "./errors.js";
import {
  FIXTURE_MODELS,
  FIXTURE_PROVIDERS,
  FIXTURE_REPOSITORIES,
  FIXTURE_USER,
} from "./internal/catalog/fixtures.js";
import { resolveApiKey } from "./internal/env.js";
import { isFixtureApiKey, shouldUseFixtureMode } from "./internal/fixture-mode.js";
import { httpRequest } from "./internal/http.js";
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
    list: (options = {}) =>
      executeCatalogRequest({
        apiKey: options.apiKey,
        fixture: FIXTURE_MODELS,
        path: "/v1/models",
      }),
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
