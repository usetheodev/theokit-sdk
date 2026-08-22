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
  /** Short, plain-text model name. Mirrors `displayName` for typical SDKs. */
  name?: string;
  displayName: string;
  description?: string;
  parameters?: ModelParameterDefinition[];
  variants?: ModelVariant[];
}

/**
 * Alias of {@link ModelListItem}, used where a model comes back from the Theokit platform rather
 * than from a catalog listing.
 *
 * It is the SAME type, not a narrowed one — the alias exists so platform-facing signatures read in
 * platform vocabulary alongside `SDKRepository` and `SDKUser`, and a value of either name is
 * assignable to the other.
 *
 * @public
 */
export type SDKModel = ModelListItem;

/**
 * GitHub repository connected to the team. Cloud-only.
 *
 * @public
 */
export interface SDKRepository {
  url: string;
}
