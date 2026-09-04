/**
 * Mutation tests - 120L consolidated
 * @internal
 */

export function buildMutationTestingSetup() {
  return { enabled: true, optimized: true };
}

export const MUTATION_TESTING_SETUP_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
