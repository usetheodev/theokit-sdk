/**
 * Fold configuration layers in a declared order — later layers win, named keys accumulate.
 *
 * Every product that reads configuration from more than one place rebuilds these two rules, and the
 * second one is not a nicety. With plain last-wins, a project file DISPLACES the user's entries for
 * a list-valued key rather than adding to them — and for a key like `hooks`, which carries arbitrary
 * command execution, that is the difference between a repository adding a hook and a repository
 * removing yours.
 *
 * The layer NAMES are the caller's, supplied as data. One product's chain is
 * defaults/user/project/profile/env/cli; `profile` is that product's idea and does not belong here.
 * That is the same test the security floor passed: a vocabulary expressible as data generalises, an
 * open-ended interface shaped by one product does not.
 *
 * @public
 */

import { TheokitAgentError } from "./errors.js";

/** Raised when a declared layer chain is not strictly ascending. @public */
export class LayerOrderError extends TheokitAgentError {
  override readonly name = "LayerOrderError";
}

/**
 * One named layer in a precedence chain.
 *
 * `precedence` is optional and the two usages do not mix well: omit it everywhere to say "this
 * array is already in order", or supply it everywhere you want `verifyLayerOrdering` to check.
 * Entries without it are SKIPPED by that check rather than treated as zero, so a chain where only
 * some entries declare a number is verified only between those.
 *
 * @public
 */
export interface DeclaredLayer {
  readonly layer: string;
  /** Higher wins. Optional — omit it to mean "this array is already the order". */
  readonly precedence?: number;
}

/**
 * A declared layer together with the values it supplies.
 *
 * `foldLayers` consumes these in array order, so a later entry wins for the keys it mentions. A key
 * a layer does not mention — or mentions with `undefined` — leaves the earlier value standing;
 * there is no way for a layer to erase a key another layer set.
 *
 * @public
 */
export interface LayerValues extends DeclaredLayer {
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * Assert that each layer strictly outranks the one before it.
 *
 * Entries without a `precedence` are skipped rather than treated as zero: omitting it means the
 * caller is expressing order by position, and inventing a number for them would manufacture a
 * conflict out of a legitimate usage.
 *
 * @throws LayerOrderError naming both layers and both precedences — a refusal that only says "out
 *   of order" sends the reader to compare the whole list by hand.
 * @public
 */
export function verifyLayerOrdering(layers: readonly DeclaredLayer[]): void {
  // Narrowed to the entries that actually declare a precedence, so the comparison below has no
  // `undefined` to reason about and the type says so.
  let previous: { layer: string; precedence: number } | undefined;
  for (const current of layers) {
    if (current.precedence === undefined) continue;
    const declared = { layer: current.layer, precedence: current.precedence };
    if (previous !== undefined && declared.precedence <= previous.precedence) {
      throw new LayerOrderError(
        `layers out of order: \`${declared.layer}\` (precedence ${String(declared.precedence)}) ` +
          `comes after \`${previous.layer}\` (precedence ${String(previous.precedence)}) but does ` +
          `not outrank it`,
      );
    }
    previous = declared;
  }
}

/**
 * Combine `entries` into one record.
 *
 * Later entries win. A value of `undefined` never overwrites — a layer that does not mention a key
 * must not erase it, because "said nothing" is overwhelmingly more common than "said nothing on
 * purpose".
 *
 * Keys in `accumulatingKeys` whose value is an array are CONCATENATED across layers instead of
 * replaced. A non-array value for such a key replaces, deliberately: a malformed config must not
 * corrupt the accumulator into a mixed list, and leaving the raw value visible lets the consumer's
 * own validation reject it with its own message.
 *
 * The accumulator is per-call and the inputs are never mutated, so folding twice yields the same
 * answer — which a consumer that folds once to display and once to apply depends on.
 *
 * @public
 */
export function foldLayers(
  entries: readonly LayerValues[],
  accumulatingKeys: readonly string[] = [],
): Record<string, unknown> {
  verifyLayerOrdering(entries);

  const accumulated = new Map<string, unknown[]>(accumulatingKeys.map((k) => [k, []]));
  const combined: Record<string, unknown> = {};

  for (const { values } of entries) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const stack = accumulated.get(key);
      if (stack !== undefined && Array.isArray(value)) {
        stack.push(...(value as readonly unknown[]));
        // The copy is defensive and NOT covered by a test, because it is not observable: the
        // accumulator is per-call and nothing touches it after the fold returns. Mutating this line
        // to `combined[key] = stack` leaves every case green — checked, not assumed. It stays
        // because returning internal mutable state from a public API is a smell that costs one
        // allocation to avoid, and the next change to this function should not have to notice.
        combined[key] = [...stack];
        continue;
      }
      combined[key] = value;
    }
  }
  return combined;
}
