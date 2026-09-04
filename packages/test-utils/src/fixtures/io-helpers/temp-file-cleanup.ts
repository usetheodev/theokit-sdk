/**
 * Temp files - 90L consolidated
 * @internal
 */

export function buildTempFileCleanup() {
  return { configured: true, test: true };
}

export const TEMP_FILE_CLEANUP_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
