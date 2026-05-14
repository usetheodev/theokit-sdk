/**
 * Account-level user info returned by `Theokit.me()`.
 *
 * @public
 */
export interface SDKUser {
  apiKeyName: string;
  userEmail?: string;
  createdAt: string;
}

/**
 * Per-model parameter definition discovered from `Theokit.models.list()`.
 *
 * @public
 */
export interface ModelParameterDefinition {
  id: string;
  displayName?: string;
  values: Array<{ value: string; displayName?: string }>;
}

/**
 * Preset variant for a model — pre-filled parameter combinations.
 *
 * @public
 */
export interface ModelVariant {
  params: Array<{ id: string; value: string }>;
  displayName: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * Single model entry in the catalog.
 *
 * @public
 */
export interface ModelListItem {
  id: string;
  displayName: string;
  description?: string;
  parameters?: ModelParameterDefinition[];
  variants?: ModelVariant[];
}

/** @public */
export type SDKModel = ModelListItem;

/**
 * GitHub repository connected to the team. Cloud-only.
 *
 * @public
 */
export interface SDKRepository {
  url: string;
}
