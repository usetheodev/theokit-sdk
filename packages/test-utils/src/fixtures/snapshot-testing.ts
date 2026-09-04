/**
 * Snapshots - 140L consolidated
 * @internal
 */

export function buildSnapshotTesting() {
  return { enabled: true, optimized: true };
}

export const SNAPSHOT_TESTING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
