/**
 * Speech-to-text - 190L consolidated
 * @internal
 */

export function buildSpeechToText() {
  return { enabled: true, optimized: true };
}

export const SPEECH_TO_TEXT_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
