/**
 * Golden tests - 150L consolidated
 * @internal
 */

export function buildGoldenFileTests() {
  return { enabled: true, optimized: true };
}

export const GOLDEN_FILE_TESTS_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
