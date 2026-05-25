/**
 * Split a long string into ≤4000-char chunks for `chat.postMessage` (ADR D272).
 *
 * Break preference: `\n\n` → `\n` → ` `. UTF-16 surrogate-pair guard prevents
 * cutting in the middle of an emoji (EC-4 absorbed).
 *
 * @internal
 */

const SLACK_MAX_TEXT = 4000;

function findCutPoint(remaining: string): number {
  let cut = remaining.lastIndexOf("\n\n", SLACK_MAX_TEXT);
  if (cut < SLACK_MAX_TEXT * 0.5) cut = remaining.lastIndexOf("\n", SLACK_MAX_TEXT);
  if (cut < SLACK_MAX_TEXT * 0.5) cut = remaining.lastIndexOf(" ", SLACK_MAX_TEXT);
  if (cut <= 0) cut = SLACK_MAX_TEXT;
  // EC-4: avoid cutting in the middle of a UTF-16 surrogate pair (emoji).
  if (cut < remaining.length) {
    const code = remaining.charCodeAt(cut);
    if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
  }
  return cut <= 0 ? SLACK_MAX_TEXT : cut;
}

export function splitForSlack(text: string): string[] {
  if (text.length <= SLACK_MAX_TEXT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > SLACK_MAX_TEXT) {
    const cut = findCutPoint(remaining);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\s]+/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
