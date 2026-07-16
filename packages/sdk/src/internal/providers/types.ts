/**
 * ProviderProfile + ApiMode types (T3.1, ADR D105).
 *
 * SE45/SE46 — the contract types now live in `types/provider-profile.ts` (above
 * the DIP boundary, because `ProviderProfile` is embedded in the public `Plugin`
 * type). This module re-exports them so every existing `../providers/types.js`
 * importer resolves the same names unchanged.
 *
 * @public
 */

export type {
  ApiMode,
  AuthType,
  ProviderProfile,
} from "../../types/provider-profile.js";
