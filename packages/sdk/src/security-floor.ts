/**
 * Resolve a security-relevant setting across configuration layers, where a lower-trust layer may
 * TIGHTEN it and never loosen it.
 *
 * Layered configuration usually resolves last-wins, and for the keys that decide confinement — a
 * sandbox mode, an approval policy — last-wins is a hole. With plain precedence a project layer
 * outranks the user's own file, so a cloned repository can hand itself the most permissive setting
 * and the operator's global choice loses silently, at the moment the directory is opened. Nothing
 * fails; the confinement is simply gone.
 *
 * ## What is generic here, and what is not
 *
 * The RULE is generic: named layers may only move the value in the confining direction, while one
 * designated layer — the operator's explicit flag — wins in both. The VOCABULARY is not: which
 * values count as more permissive, what the layers are called, and which one is the operator's are
 * all the consumer's, and are parameters.
 *
 * That distinction is what makes this extractable when a keypress router was not. Here the
 * vocabulary is DATA — two lists and a name — so a second product supplies its own without
 * inheriting the first's words. An interface shaped by one product's states would have given the
 * second consumer something to route around.
 *
 * ## Why the override is not validated
 *
 * `override` is returned verbatim, even when it is outside `permissiveness`. Validating the
 * operator's flag is the consumer's job: it owns the vocabulary, the error message and the exit
 * code. Silently dropping an unrecognised flag would be worse than passing it through — the
 * operator would see their explicit instruction ignored with no explanation.
 *
 * A value outside the vocabulary in a RESTRICTED layer is different and IS ignored: a typo in a
 * repository's config must neither become the effective setting nor be treated as maximally
 * permissive.
 *
 * @public
 */

/**
 * The vocabulary, the layer names, and the values to resolve.
 *
 * Two orders matter and they are not the same one. The UNRESTRICTED layers — every key of `layers`
 * that is neither `override` nor listed in `restricted` — are resolved last-wins in the enumeration
 * order of the `layers` object. The RESTRICTED layers are applied in the order of the `restricted`
 * array, regardless of where they sit in `layers`. Put a layer in `restricted` and its position in
 * that array is what decides when it gets to tighten.
 *
 * A layer named in `restricted` but absent from `layers`, or present with `undefined`, is skipped.
 *
 * @public
 */
export interface SecurityFloorInput {
  /**
   * The vocabulary, ordered from most confined to least. Index is permissiveness, so
   * `["read-only", "workspace-write", "danger-full-access"]` says read-only confines the most.
   */
  readonly permissiveness: readonly string[];
  /** Layers that may only tighten — typically anything a repository or environment can supply. */
  readonly restricted: readonly string[];
  /** The layer that wins outright in both directions — the operator's explicit flag. */
  readonly override: string;
  /**
   * Values per layer. Layers absent from `restricted` are unconstrained, which is how a `user`
   * layer loosens its own `defaults`.
   */
  readonly layers: Readonly<Record<string, string | undefined>>;
}

/** Index in `order`, or -1 when the value is absent or outside the vocabulary. @internal */
function permissivenessOf(order: readonly string[], value: string | undefined): number {
  if (value === undefined) return -1;
  return order.indexOf(value);
}

/**
 * The value the restricted layers must not exceed, taken from the unrestricted layers in the order
 * given. Separated because it answers a different question from the floor itself: what did the
 * operator and the defaults already settle on, before any repository or environment had a say.
 *
 * @internal
 */
function baseline(input: SecurityFloorInput): string | undefined {
  const { restricted, override, layers } = input;
  let value: string | undefined;
  for (const [name, candidate] of Object.entries(layers)) {
    if (name === override || restricted.includes(name)) continue;
    if (candidate !== undefined) value = candidate;
  }
  return value;
}

/**
 * Apply the restricted layers to `start`, letting each one CONFINE and never widen.
 *
 * @internal
 */
function tightenOnly(input: SecurityFloorInput, start: string | undefined): string | undefined {
  const { permissiveness, restricted, layers } = input;
  let resolved = start;
  let ceiling = permissivenessOf(permissiveness, start);

  for (const layer of restricted) {
    const candidate = layers[layer];
    if (candidate === undefined) continue;
    const level = permissivenessOf(permissiveness, candidate);
    // Outside the vocabulary: ignored rather than trusted. See the docblock.
    if (level < 0) continue;
    // With no ceiling yet the layer is choosing, not widening.
    if (ceiling >= 0 && level > ceiling) continue;
    resolved = candidate;
    // Assigned, never max'd: the ceiling only ever descends, so a layer that hardens binds the
    // ones after it. A mutation to `Math.max` here is invisible until a later layer offers a value
    // between the old and new ceiling — which is why that case is written out in the tests.
    ceiling = level;
  }
  return resolved;
}

/**
 * Resolve a security-relevant setting so that a lower-trust layer can only tighten it.
 *
 * Two paths. When `layers[override]` holds a value, that value is returned VERBATIM and nothing
 * else is consulted — it is not checked against `permissiveness`, because validating the operator's
 * own flag belongs to the consumer that owns the vocabulary and the error message. Otherwise a
 * baseline is taken from the unrestricted layers, and each restricted layer in turn may lower it
 * and never raise it.
 *
 * Two consequences worth knowing before wiring this up. A value in a restricted layer that is not
 * in `permissiveness` is IGNORED rather than trusted, so a typo in a repository's config leaves the
 * baseline standing instead of becoming the effective setting. And the ceiling only ever descends:
 * once one restricted layer tightens, a later one cannot return to the baseline, even though it
 * could have chosen that value had it come first.
 *
 * When no layer supplied a value at all, the answer is `undefined` — the absence is reported rather
 * than filled in with the most confined member of the vocabulary.
 *
 * @returns the resolved value, or `undefined` when no layer supplied one.
 * @public
 */
export function applySecurityFloor(input: SecurityFloorInput): string | undefined {
  return input.layers[input.override] ?? tightenOnly(input, baseline(input));
}
