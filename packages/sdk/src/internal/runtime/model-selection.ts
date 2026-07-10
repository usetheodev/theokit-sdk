/**
 * SE8 — boundary normalizer for the model bare-string shorthand.
 *
 * `AgentOptions.model` and `SendOptions.model` accept `string | ModelSelection`
 * (matching every peer SDK's `"provider/model"` shorthand). This is the ONE seam
 * that maps a bare string to `{ id }`, so all downstream code keeps seeing a
 * `ModelSelection`. `"inherit"` is an `AgentOptions`-only sentinel handled inline
 * at the create seam — NOT here — so this helper stays `string | ModelSelection`.
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import type { ModelSelection } from "../../types/agent-prims.js";

/** Normalize a model selection: a bare string id → `{ id }`; object/undefined pass through. */
export function normalizeModel(m: string | ModelSelection | undefined): ModelSelection | undefined {
  if (m === undefined || typeof m !== "string") return m;
  const id = m.trim();
  if (id.length === 0) {
    throw new ConfigurationError(
      'model must be a non-empty "provider/model" id string or a ModelSelection object',
      { code: "invalid_model_selection" },
    );
  }
  return { id };
}
