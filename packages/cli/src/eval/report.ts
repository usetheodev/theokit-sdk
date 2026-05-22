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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function escapeMd(s: string): string {
  return s.replaceAll("|", "\\|").replaceAll("\n", " ");
}
