/**
 * Telegram's 4096-char per-message cap. Split agent responses on safe
 * boundaries before sending (T5.1, ported from examples/telegram-pro
 * with EC-J markdown-pair preservation).
 */

const TELEGRAM_MAX_MESSAGE = 4096;
const SAFE_CHUNK = 4000;

/**
 * Split a long text into Telegram-sized chunks, preferring paragraph,
 * line, then hard boundaries. EC-J: when a chunk ends in the middle of
 * a markdown pair (`**`, `__`, `~~`, `` ` ``), trim back to the last
 * complete pair so neither chunk produces a "markdown_parse_error" 400.
 *
 * @public
 */
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
    let chunk = remaining.slice(0, boundary);
    chunk = balanceMarkdownPairs(chunk);
    boundary = chunk.length;
    parts.push(chunk);
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }
  return parts;
}

/**
 * EC-J: trim back to before an unbalanced markdown marker so the
 * chunk passes Telegram MarkdownV1 parsing.
 */
function balanceMarkdownPairs(chunk: string): string {
  const markers = ["**", "__", "~~", "`"];
  let out = chunk;
  for (const m of markers) {
    const count = countOccurrences(out, m);
    if (count % 2 === 1) {
      const lastIdx = out.lastIndexOf(m);
      out = out.slice(0, lastIdx).trimEnd();
    }
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while (true) {
    const found = haystack.indexOf(needle, pos);
    if (found === -1) break;
    count += 1;
    pos = found + needle.length;
  }
  return count;
}
