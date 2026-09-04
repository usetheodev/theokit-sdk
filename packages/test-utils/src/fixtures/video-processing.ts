/**
 * Video proc - 120L consolidated
 * @internal
 */

export function buildVideoProcessing() {
  return { enabled: true, optimized: true };
}

export const VIDEO_PROCESSING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
