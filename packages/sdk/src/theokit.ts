import { ConfigurationError } from "./errors.js";
import type { SDKProvider } from "./types/providers.js";
import type { SDKModel, SDKRepository, SDKUser } from "./types/theokit.js";

const NOT_IMPLEMENTED = "Not implemented yet — see CHANGELOG.md and docs.md";

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
  static me(_options?: TheokitRequestOptions): Promise<SDKUser> {
    return Promise.reject(new ConfigurationError(`Theokit.me: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Model catalog reads.
   *
   * @public
   */
  static readonly models: {
    list: (options?: TheokitRequestOptions) => Promise<SDKModel[]>;
  } = {
    list: (_options) =>
      Promise.reject(new ConfigurationError(`Theokit.models.list: ${NOT_IMPLEMENTED}`)),
  };

  /**
   * Connected GitHub repositories for the calling user's team. Cloud only.
   *
   * @public
   */
  static readonly repositories: {
    list: (options?: TheokitRequestOptions) => Promise<SDKRepository[]>;
  } = {
    list: (_options) =>
      Promise.reject(new ConfigurationError(`Theokit.repositories.list: ${NOT_IMPLEMENTED}`)),
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
    list: (_options) =>
      Promise.reject(new ConfigurationError(`Theokit.providers.list: ${NOT_IMPLEMENTED}`)),
  };
}
