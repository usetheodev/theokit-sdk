/**
 * Audit whether every configuration key can be set from the environment, or says why not.
 *
 * A key settable only by editing a file cannot be set in CI, in a container, or for a single
 * invocation. That is usually an oversight rather than a decision, and it is invisible — nothing
 * fails, the key simply has no environment path, and nobody notices until someone needs one.
 *
 * The opposite failure rots more quietly. An opt-out written for a key that has since gained an
 * environment path, or for a key that no longer exists, still reads as a considered decision while
 * exempting nothing. Both questions are answered by one call so a consumer cannot check the gap and
 * forget the rot: they fail for opposite reasons, and a suite that asks only one looks complete.
 *
 * ## Why the framework owns the rule and not the keys
 *
 * A framework cannot enumerate a consumer's configuration keys, and should not try. Which keys exist
 * is that product's vocabulary — the same reason the security floor takes its permissiveness order
 * as data and the trust posture takes its capability list. So the consumer ranges over its own keys
 * with this, rather than registering them here.
 *
 * That is a narrower claim than "reachability is checked in the framework", and it is the honest
 * one: the failure still surfaces in the consumer's own suite. What the consumer no longer writes is
 * the detector, which is where the subtlety lives — the stale-opt-out half is the part everyone
 * forgets.
 *
 * @public
 */

/** A key deliberately left off the environment, with the reason and what would reverse it. @public */
export interface EnvOptOut {
  readonly key: string;
  /** Why an environment variable is the wrong shape for this key. */
  readonly reason: string;
  /** What would make this opt-out obsolete. An opt-out with no exit is a permanent excuse. */
  readonly exitCriterion: string;
}

/** @public */
export interface EnvReachabilityInput {
  /** Every configuration key the product declares. */
  readonly keys: readonly string[];
  /** The subset that an environment variable can set. */
  readonly reachable: readonly string[];
  /** Documented exemptions for keys that deliberately have no environment path. */
  readonly optOuts: readonly EnvOptOut[];
}

/** @public */
export interface EnvReachabilityAudit {
  /** Keys with neither an environment path nor a documented opt-out. */
  readonly unreachable: readonly string[];
  /** Opt-outs that exempt nothing: the key gained an environment path, or no longer exists. */
  readonly staleOptOuts: readonly string[];
}

/**
 * @returns both axes, in the order the caller declared them — a stable order so a failure message
 *   does not change between runs for reasons unrelated to the code.
 * @public
 */
export function auditEnvReachability(input: EnvReachabilityInput): EnvReachabilityAudit {
  const reachable = new Set(input.reachable);
  const exempt = new Set(input.optOuts.map((o) => o.key));
  const declared = new Set(input.keys);

  return {
    unreachable: input.keys.filter((k) => !reachable.has(k) && !exempt.has(k)),
    staleOptOuts: input.optOuts
      .filter((o) => !declared.has(o.key) || reachable.has(o.key))
      .map((o) => o.key),
  };
}
