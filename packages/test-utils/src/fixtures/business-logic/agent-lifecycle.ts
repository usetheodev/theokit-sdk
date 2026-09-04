/**
 * Agent lifecycle - 300L consolidated
 * @internal
 */

export function buildAgentLifecycle() {
  return { configured: true, active: true };
}

export const AGENT_LIFECYCLE_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
