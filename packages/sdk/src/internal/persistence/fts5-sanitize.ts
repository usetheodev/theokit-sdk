/**
 * FTS5 query sanitization + CJK detection (ADR D64).
 *
 * Port of Hermes' 6-step sanitizer (`hermes_state.py:1797-1847`). Prevents
 * crashes on user inputs with hyphens, dots, underscores, and unmatched
 * specials. Auto-quotes identifier-shaped tokens so `error-code` finds
 * literal `error-code` instead of `error AND code`.
 *
 * CJK detection returns true for inputs containing characters in the main
 * CJK Unicode ranges (Chinese, Japanese, Korean). CJK trigram routing is
 * deferred to v1.4 — callers receiving `containsCjk === true` should
 * short-circuit to an empty result or LIKE fallback for v1.3.
 *
 * @internal
 */

// Control-char sentinels for the phrase-preservation placeholder. U+0001
// and U+0002 are essentially never present in real user queries, and
// crucially do NOT form word boundaries / `\w` characters, so Step 5's
// auto-quote regex (`\b\w+[-._]\w[\w\-._]*\b`) cannot match them.
// Choosing `__PHRASE_N__` instead would re-trigger Step 5 on the second
// sanitize pass and break idempotence.
const PHRASE_OPEN = "";
const PHRASE_CLOSE = "";

/**
 * Six-step FTS5 query sanitizer. Returns a query string safe for passing
 * to `WHERE <fts5_table> MATCH ?` as a parameter.
 *
 * Returns empty string when the input contains only specials (caller MUST
 * short-circuit to avoid runtime SQL error — EC-3).
 *
 */
export function sanitizeFts5Query(query: string): string {
  if (query.length === 0) return query;

  // Step 1: preserve "quoted phrases" via control-char placeholders.
  const phrases: string[] = [];
  let text = query.replace(/"[^"]+"/g, (match) => {
    phrases.push(match);
    return `${PHRASE_OPEN}${phrases.length - 1}${PHRASE_CLOSE}`;
  });

  // Step 2: strip unmatched specials (brackets, braces, parens, double quotes, caret).
  text = text.replace(/[[\]{}()"^]/g, " ");

  // Step 3: collapse repeated asterisks (FTS5 prefix operator is single `*`).
  text = text.replace(/\*+/g, "*");

  // Step 4: strip dangling boolean operators (AND/OR/NOT) at start/end.
  text = text.replace(/^\s*(AND|OR|NOT)\s+/i, "");
  text = text.replace(/\s+(AND|OR|NOT)\s*$/i, "");

  // Step 5: auto-quote identifier-shaped tokens that contain `-`, `.`, or `_`.
  // FTS5 tokenizer would otherwise split them as boolean conjunctions.
  text = text.replace(/\b\w+[-._]\w[\w\-._]*\b/g, (match) => `"${match}"`);

  // Step 6: restore preserved phrases.
  for (let i = 0; i < phrases.length; i += 1) {
    text = text.replace(`${PHRASE_OPEN}${i}${PHRASE_CLOSE}`, phrases[i] ?? "");
  }

  return text.trim();
}

// CJK code-point ranges. Coverage matches Hermes' coarse detection for v1.3;
// fine-grained trigram routing comes in v1.4.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3000, 0x303f], // CJK Symbols and Punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xac00, 0xd7af], // Hangul Syllables
];

/**
 * Report whether `text` holds at least one Chinese, Japanese or Korean character.
 *
 * Iterates by code point, so surrogate pairs are handled correctly, and returns on the first hit.
 * An empty string is `false`.
 *
 * Coverage is deliberately coarse: CJK Symbols and Punctuation, Hiragana, Katakana, Hangul
 * Syllables, and CJK Unified Ideographs including Extension A. Everything beyond that — the
 * higher ideograph extensions, Halfwidth and Fullwidth Forms, Hangul Jamo — reads as `false`, so
 * a `false` is not proof that the text is CJK-free.
 *
 * The reason to ask is FTS5: the default tokenizer splits on whitespace, which CJK text does not
 * use, so a matching query against it returns nothing rather than failing. A caller seeing `true`
 * should short-circuit to an empty result or a LIKE fallback instead of running the search and
 * reporting no matches.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export function containsCjk(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    for (const [lo, hi] of CJK_RANGES) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}
