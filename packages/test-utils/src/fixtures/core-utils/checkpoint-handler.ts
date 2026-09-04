/**
 * Checkpoints - 80L consolidated
 * @internal
 */

export function buildCheckpointHandler() {
  return { configured: true, active: true };
}

export const CHECKPOINT_HANDLER_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
