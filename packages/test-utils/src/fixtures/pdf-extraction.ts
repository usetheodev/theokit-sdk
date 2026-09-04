/**
 * PDF extract - 140L consolidated
 * @internal
 */

export function buildPdfExtraction() {
  return { enabled: true, optimized: true };
}

export const PDF_EXTRACTION_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
