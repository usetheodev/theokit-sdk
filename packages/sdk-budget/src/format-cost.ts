/**
 * M7-6 — honest-null cost render helper. Turns the `number | undefined` cost
 * (from `computeUsdCost` / `getTotalUsd`, M1-6) into a display string: an
 * unknown cost renders as `"—"` (NEVER a dishonest `"$0"`), a real number
 * renders as `"$X.XX"`. Composes the cost-honesty contract — a known-zero cost
 * (`0`) is distinct from an unknown one (`undefined`).
 *
 * @public
 */

/** Options for {@link formatCostUsd}. */
export interface FormatCostUsdOptions {
  /** Marker for an unknown cost (`undefined`). Default `"—"`. */
  readonly unknown?: string;
  /** Currency prefix for a known cost. Default `"$"`. */
  readonly currency?: string;
}

/**
 * Render a USD cost for display. `undefined` -> the unknown marker (`"—"` by
 * default); a number -> `"$X.XX"` (2 decimal places). `0` is a real known-zero
 * and renders `"$0.00"`, NOT the unknown marker.
 */
export function formatCostUsd(cost: number | undefined, opts: FormatCostUsdOptions = {}): string {
  if (cost === undefined) return opts.unknown ?? "—";
  return `${opts.currency ?? "$"}${cost.toFixed(2)}`;
}
