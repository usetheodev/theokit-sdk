/**
 * GraphQL - 140L consolidated
 * @internal
 */

export function buildHttpGraphql() {
  return { configured: true, test: true };
}

export const HTTP_GRAPHQL_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
