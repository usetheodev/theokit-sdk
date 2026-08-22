/**
 * Decide which session artifacts may be deleted — and never delete them.
 *
 * This package creates session artifacts (transcripts, locks, temp files) and cleans up only what is
 * in flight in the operation doing the cleaning: a lock it just released, a `.tmp` from a failed
 * atomic write. Nothing collects the rest, so every consumer either writes its own collector or lets
 * the directory grow without bound — and a hand-rolled collector on the path that deletes a user's
 * transcript is the worst place for each product to learn the same lessons separately.
 *
 * ## Planning is not deleting, deliberately
 *
 * A function that decided AND deleted could not be tested without a filesystem, and the case that
 * matters most — "we could not establish whether this session is live" — would have to be simulated
 * rather than asserted. Here the decision is pure: the plan IS the dry run, and executing it is a
 * separate act on a value someone can read first. That separation is the dry-run guarantee, rather
 * than a flag that has to be remembered.
 *
 * ## The tri-state
 *
 * `keep`, `reap`, `undetermined`. An artifact whose liveness could not be established is never
 * reaped and never quietly counted as dead. Collapsing "could not determine" into "not there" is how
 * a collector deletes a session running on another machine, or behind a mount that answered slowly.
 * The third bucket costs a branch and buys the only guarantee worth having on this path.
 *
 * @public
 */

import { TheokitAgentError } from "./errors.js";

/** Raised when a retention policy cannot be honoured as written. @public */
export class RetentionPolicyError extends TheokitAgentError {
  override readonly name = "RetentionPolicyError";
}

/**
 * One artifact the caller is considering deleting, described well enough to decide about.
 *
 * `id` is only ever compared for equality, so any stable identity works — a path, a session id, an
 * inode. `live` is the tri-state that carries the whole safety property: `"unknown"` means the
 * caller could not establish liveness, and it is honoured as a third answer rather than folded into
 * `false`.
 *
 * @public
 */
export interface ReapableArtifact {
  readonly id: string;
  /** Epoch milliseconds. Compared against an injected `nowMs`, never against a read clock. */
  readonly lastModifiedMs: number;
  /**
   * Whether a writer still holds this artifact. `"unknown"` when the caller could not establish it —
   * a stale lock behind a slow mount, a PID on another host — and it is honoured as a third answer
   * rather than folded into `false`.
   */
  readonly live: boolean | "unknown";
}

/**
 * How long artifacts are kept and how many always survive.
 *
 * The two interact as a window plus a FLOOR, not as two independent allowances: `keepLast` rescues
 * artifacts only when the window and liveness together spared fewer than that many, and rescues
 * exactly enough to reach the count. Both are refused by `planReaping` rather than clamped when
 * they are not expressible — see its `@throws`.
 *
 * @public
 */
export interface RetentionPolicy {
  /** Artifacts strictly older than this are candidates. The boundary itself is kept. */
  readonly maxAgeMs: number;
  /**
   * A FLOOR on how many artifacts survive: "you will always have your last N sessions". When
   * liveness and the retention window already spare N or more, this changes nothing; when they
   * spare fewer, the newest of the remainder are spared until the count reaches N.
   *
   * Undetermined artifacts do NOT count toward the floor. Their liveness was never established, so
   * counting them would let a transient mount failure satisfy the floor with artifacts nobody
   * confirmed exist as sessions — and quietly delete the ones that do.
   */
  readonly keepLast: number;
}

/** Why an artifact survived. @public */
export type KeepReason = "live" | "within-retention" | "keep-last";

/**
 * An artifact that survived, carrying the reason it did.
 *
 * The reason is the one that spared it FIRST, in the order liveness, then the retention window,
 * then the floor — so a live artifact inside the window reports `"live"`, and `"keep-last"` only
 * appears on artifacts that had no reason of their own.
 *
 * @public
 */
export interface KeptArtifact extends ReapableArtifact {
  readonly reason: KeepReason;
}

/**
 * The decision, as three disjoint buckets whose union is exactly the input.
 *
 * Nothing is deleted by producing one of these — the plan IS the dry run, and executing it is a
 * separate act on a value you can read first. Delete only what is in `reap`; `undetermined` is not
 * a smaller `reap`, it is the set nobody could decide about.
 *
 * @public
 */
export interface ReapPlan {
  /** Safe to delete. Everything here was decided, not defaulted. */
  readonly reap: readonly ReapableArtifact[];
  readonly keep: readonly KeptArtifact[];
  /** Liveness could not be established. Never deleted, never counted as kept. */
  readonly undetermined: readonly ReapableArtifact[];
}

/**
 * Everything `planReaping` needs: the candidates, the policy, and the current time.
 *
 * `nowMs` is a parameter rather than a clock read so the same input always produces the same plan —
 * which is what lets a caller compute a plan, show it, and execute it later against the same
 * decision instead of a freshly re-derived one.
 *
 * @public
 */
export interface ReapPlanInput {
  readonly artifacts: readonly ReapableArtifact[];
  readonly retention: RetentionPolicy;
  /** Injected so the plan is reproducible and testable; this module never reads a clock. */
  readonly nowMs: number;
}

/**
 * Refuse a policy that cannot be honoured as written. Nonsense is not clamped: on this path a
 * clamped window deletes data the operator meant to keep.
 *
 * @internal
 */
function assertPolicy(retention: RetentionPolicy): void {
  const { maxAgeMs, keepLast } = retention;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new RetentionPolicyError(
      `retention.maxAgeMs must be a non-negative number of milliseconds, got ${String(maxAgeMs)}`,
    );
  }
  if (!Number.isInteger(keepLast) || keepLast < 0) {
    throw new RetentionPolicyError(
      `retention.keepLast must be a non-negative integer, got ${String(keepLast)}`,
    );
  }
}

/**
 * Everything spared for a reason of its own — liveness, or the retention window. What survives this
 * pass is what the floor then has to decide about.
 *
 * @internal
 */
function classifyByOwnReason(input: ReapPlanInput): {
  keep: KeptArtifact[];
  atRisk: ReapableArtifact[];
} {
  const keep: KeptArtifact[] = [];
  const atRisk: ReapableArtifact[] = [];

  for (const artifact of input.artifacts) {
    if (artifact.live === "unknown") continue;
    // Liveness first: a session that has not written for weeks is still running, and deleting its
    // transcript underneath it loses everything it has not flushed.
    if (artifact.live === true) {
      keep.push({ ...artifact, reason: "live" });
      continue;
    }
    // The boundary belongs to the safe side: at exactly the window, keep. Reaping there makes a
    // 30-day retention sometimes mean 29, depending on clock granularity.
    if (input.nowMs - artifact.lastModifiedMs <= input.retention.maxAgeMs) {
      keep.push({ ...artifact, reason: "within-retention" });
      continue;
    }
    atRisk.push(artifact);
  }
  return { keep, atRisk };
}

/**
 * The floor. `keepLast` is a promise about how many sessions survive in total, not a bonus on top of
 * the window — the standard reading of "keep last N", and the one explainable in a sentence. When
 * the window already spared enough, nothing more is rescued.
 *
 * @internal
 */
function applyFloor(
  kept: readonly KeptArtifact[],
  atRisk: readonly ReapableArtifact[],
  keepLast: number,
): { rescued: KeptArtifact[]; reap: ReapableArtifact[] } {
  const shortfall = Math.max(0, keepLast - kept.length);
  const newestFirst = [...atRisk].sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const spared = new Set(newestFirst.slice(0, shortfall).map((a) => a.id));

  const rescued: KeptArtifact[] = [];
  const reap: ReapableArtifact[] = [];
  for (const artifact of atRisk) {
    if (spared.has(artifact.id)) rescued.push({ ...artifact, reason: "keep-last" });
    else reap.push(artifact);
  }
  return { rescued, reap };
}

/**
 * Sort artifacts into keep, reap, and undetermined — and delete nothing.
 *
 * The order of decision is liveness, then the retention window, then the floor. An artifact whose
 * `live` is `"unknown"` leaves at the first step and is never considered again: it is not counted
 * toward `keepLast`, so a transient mount failure cannot satisfy "keep my last two" with artifacts
 * nobody confirmed while the confirmed ones are deleted.
 *
 * The window boundary belongs to the safe side. An artifact exactly `maxAgeMs` old is kept, so a
 * 30-day retention never means 29 depending on clock granularity.
 *
 * @returns the three buckets. Their union is exactly the input, each artifact counted once — the
 *   invariant an operator reads the totals against.
 * @throws RetentionPolicyError when `maxAgeMs` is negative or not finite, or `keepLast` is negative
 *   or not an integer. Nonsense is refused rather than clamped, because a clamped window on this
 *   path deletes data the operator meant to keep.
 * @public
 */
export function planReaping(input: ReapPlanInput): ReapPlan {
  assertPolicy(input.retention);

  // Undetermined artifacts are set aside before anything else and never counted toward the floor: a
  // transient mount failure must not satisfy "keep 2" with artifacts nobody confirmed, while the
  // confirmed ones are deleted.
  const undetermined = input.artifacts.filter((a) => a.live === "unknown");
  const { keep, atRisk } = classifyByOwnReason(input);
  const { rescued, reap } = applyFloor(keep, atRisk, input.retention.keepLast);

  return { reap, keep: [...keep, ...rescued], undetermined };
}
