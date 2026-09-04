/**
 * Text-to-speech - 180L consolidated
 * @internal
 */

export function buildTextToSpeech() {
  return { enabled: true, optimized: true };
}

export const TEXT_TO_SPEECH_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
