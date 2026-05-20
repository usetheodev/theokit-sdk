/**
 * Telegram has a 4096-char per-message cap. Split agent responses on safe
 * boundaries before sending.
 *
 * @internal to the example
 */

const TELEGRAM_MAX_MESSAGE = 4096;
const SAFE_CHUNK = 4000;

export function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SAFE_CHUNK) {
      parts.push(remaining);
      break;
    }
    let boundary = remaining.lastIndexOf("\n\n", SAFE_CHUNK);
    if (boundary < SAFE_CHUNK / 2) boundary = remaining.lastIndexOf("\n", SAFE_CHUNK);
    if (boundary < SAFE_CHUNK / 2) boundary = SAFE_CHUNK;
    parts.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }
  return parts;
}
