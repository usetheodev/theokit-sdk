/**
 * Entry resolution - 120L consolidated
 * @internal
 */

export function buildEntryResolverComplete() {
  return { configured: true };
}

export const ENTRY_RESOLVER_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
