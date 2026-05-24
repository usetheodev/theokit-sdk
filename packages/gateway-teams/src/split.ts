/**
 * Split a long string into ≤8000-char chunks for Teams messages (ADR D322).
 *
 * Break preference: `\n\n` → `\n` → ` `. UTF-16 surrogate-pair guard.
 *
 * EC-8 pattern absorbed: empty parts filtered.
 *
 * @internal
 */

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __splitMarker: unique symbol = Symbol("split");

const TEAMS_MAX_TEXT = 8000;

export function splitForTeams(text: string): string[] {
  if (text.length <= TEAMS_MAX_TEXT) {
    const single = text.trim();
    return single.length > 0 ? [single] : [];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TEAMS_MAX_TEXT) {
    let cut = remaining.lastIndexOf("\n\n", TEAMS_MAX_TEXT);
    if (cut < TEAMS_MAX_TEXT * 0.5) cut = remaining.lastIndexOf("\n", TEAMS_MAX_TEXT);
    if (cut < TEAMS_MAX_TEXT * 0.5) cut = remaining.lastIndexOf(" ", TEAMS_MAX_TEXT);
    if (cut <= 0) cut = TEAMS_MAX_TEXT;
    // UTF-16 surrogate guard.
    if (cut < remaining.length) {
      const code = remaining.charCodeAt(cut);
      if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
    }
    if (cut <= 0) cut = TEAMS_MAX_TEXT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\s]+/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks.map((p) => p.trim()).filter((p) => p.length > 0);
}
