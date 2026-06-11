/**
 * Status bar formatting logic for TheoCode TUI.
 *
 * Produces a single-line string that fits within the given terminal width.
 */

export interface StatusBarData {
  model: string;
  session: string;
  tokens: number;
  cost?: number;
  mode: string;
}

/**
 * Format a status bar string, truncating to fit `maxWidth`.
 *
 * Layout: `[mode] model | session | tokens tok | $cost`
 */
export function formatStatusBar(data: StatusBarData, maxWidth: number): string {
  const parts: string[] = [
    `[${data.mode}]`,
    data.model,
    "|",
    data.session,
    "|",
    `${data.tokens} tok`,
  ];

  if (data.cost !== undefined) {
    parts.push("|", `$${data.cost.toFixed(4)}`);
  }

  const full = parts.join(" ");
  if (full.length <= maxWidth) return full;

  return `${full.slice(0, maxWidth - 1)}\u2026`;
}
