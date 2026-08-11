/**
 * Decide what a project directory is allowed to switch on.
 *
 * A product that reads a repository has to answer this before it builds anything: are that
 * repository's hooks honoured, are its MCP servers started, do its instructions enter the persona?
 * The stakes are not configuration-shaped. A hook is arbitrary command execution on every tool
 * call, and an MCP server is an external process SPAWNED while the agent is built — before any
 * per-tool approval exists to refuse it. A product that gets this wrong grants local execution on
 * first build, in a directory the user only meant to open.
 *
 * ## What this is, and what it deliberately is not
 *
 * The arithmetic is small: pick a level, derive one boolean per capability. The value is the
 * INVARIANT — untrusted means EVERY declared capability is off, and `allows` is built FROM the
 * declared list, so a product that adds a ninth capability cannot forget to gate it. That failure
 * is invisible when it happens: the new capability simply works in a directory where it should not,
 * and nothing reports anything.
 *
 * It does NOT decide what "trusted" means. Where the record lives, what the environment variable is
 * called, whether a legacy alias is still honoured — all of that is the consumer's, because all of
 * it is that product's vocabulary. The framework owns the shape of the answer and the guarantee
 * that the answer covers everything declared.
 *
 * ## Why `source` is reported
 *
 * "Trusted because the operator recorded this directory" and "trusted because a blanket environment
 * switch is on" are different facts. A surface that only shows `trusted` cannot warn about the
 * second, which is the one that stays on across every directory the process ever opens.
 *
 * @public
 */

/** @public */
export type TrustLevel = "trusted" | "untrusted";

/** Where the decision came from. @public */
export type TrustSource = "env" | "store" | "default";

/** @public */
export interface TrustPostureInput<K extends string> {
  /**
   * Every capability a repository could switch on. `allows` is built from exactly this list — the
   * guarantee that nothing is left ungated.
   */
  readonly capabilities: readonly K[];
  /**
   * Whether the operator has recorded this directory as trusted. Called at most once, and not at
   * all when `envOverride` already granted trust — it may touch the filesystem.
   */
  readonly isTrusted: () => boolean;
  /**
   * A blanket override from the consumer's own environment vocabulary. `true` grants trust;
   * `false` and `undefined` both mean "the operator did not switch it on" — NOT "switched it off",
   * because an unset variable must not override a trusted store.
   */
  readonly envOverride?: boolean;
}

/** @public */
export interface TrustPosture<K extends string> {
  readonly level: TrustLevel;
  readonly source: TrustSource;
  /** One entry per declared capability. Every value is `false` when the level is untrusted. */
  readonly allows: Readonly<Record<K, boolean>>;
}

/** @public */
export function resolveTrustPosture<K extends string>(
  input: TrustPostureInput<K>,
): TrustPosture<K> {
  const source: TrustSource =
    input.envOverride === true ? "env" : input.isTrusted() ? "store" : "default";
  const level: TrustLevel = source === "default" ? "untrusted" : "trusted";
  const granted = level === "trusted";

  // Built from the declared list rather than from anything the caller passes per capability: that
  // is what makes "nothing is ungated" a property of the type instead of a habit.
  const allows = Object.fromEntries(input.capabilities.map((key) => [key, granted])) as Record<
    K,
    boolean
  >;

  return { level, source, allows };
}
