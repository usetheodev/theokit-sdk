/**
 * Markdown report emitter for `theokit eval` (T5.1).
 *
 * @internal
 */

import type { EvalRunResult } from "./types.js";

export function formatReport(result: EvalRunResult): string {
  const lines: string[] = [];
  lines.push("# Eval Report");
  lines.push("");
  lines.push(`- **Total rows:** ${result.aggregate.totalRows}`);
  lines.push(`- **Mean score:** ${result.aggregate.meanScore.toFixed(3)}`);
  lines.push(`- **Pass ratio (≥0.5):** ${(result.aggregate.passRatio * 100).toFixed(1)}%`);
  lines.push(`- **Error rows:** ${result.aggregate.errorRows}`);
  lines.push("");
  lines.push("## Per-row results");
  lines.push("");
  lines.push("| # | Input | Output | Mean | Scores | Notes |");
  lines.push("|---|---|---|---:|---|---|");
  for (let i = 0; i < result.rows.length; i += 1) {
    const row = result.rows[i];
    if (row === undefined) continue;
    const input = escapeMd(truncate(row.input, 60));
    const output = row.error !== undefined ? `*error*` : escapeMd(truncate(row.output, 80));
    const mean = row.meanScore.toFixed(3);
    const scores =
      row.scores.length > 0
        ? row.scores
            .map(
              (s) =>
                `${s.name}=${s.score.toFixed(2)}${s.reason !== undefined ? ` (${escapeMd(s.reason)})` : ""}`,
            )
            .join("; ")
        : "—";
    const notes = row.error !== undefined ? escapeMd(row.error) : "";
    lines.push(`| ${i + 1} | ${input} | ${output} | ${mean} | ${scores} | ${notes} |`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Truncate to at most `max` UTF-16 code units, cutting only on a CHARACTER boundary (#342).
 *
 * `String.prototype.slice` counts code units, so a cut that lands between the halves of a
 * surrogate pair keeps one half. A lone surrogate is not a Unicode scalar value: it has no UTF-8
 * encoding, so a writer, a diff tool or a markdown renderer downstream either substitutes U+FFFD
 * or rejects the file. Any dataset with emoji, astral CJK or mathematical alphanumerics hits it.
 *
 * The budget stays in code UNITS, deliberately — it exists to keep the markdown table narrow, and
 * a surrogate pair does occupy two of them. What changes is where the cut may fall: this walks the
 * string by code point (the default string iterator) and stops before the first one that would not
 * fit, so the result is at most `max` units and always well-formed.
 *
 * NOT grapheme segmentation. `Intl.Segmenter` would additionally keep a ZWJ sequence (a family
 * emoji, a flag) or a combining mark whole, which renders better — but splitting one produces a
 * VALID string that merely looks odd, while splitting a surrogate pair produces an invalid one.
 * Only the second is a correctness defect, and this fixes exactly that.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const budget = max - 1; // one unit reserved for the ellipsis
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > budget) break;
    out += ch;
  }
  return `${out}…`;
}

function escapeMd(s: string): string {
  return s.replaceAll("|", "\\|").replaceAll("\n", " ");
}
