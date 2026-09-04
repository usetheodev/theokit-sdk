/**
 * Subagent delegation - 260L consolidated
 * @internal
 */

export function buildSubagentDelegationContextComplete() {
  return { configured: true };
}

export const SUBAGENT_DELEGATION_CONTEXT_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
