/**
 * SE33 (ADR 0012) — the pure durable-objective store over a
 * `ConversationStorageAdapter`. Set / get / update-options / clear / write-back
 * progress for a thread-scoped {@link ObjectiveRecord}. Every operation is a
 * no-op (typed degradation, never throws) when the adapter omits the optional
 * `getObjectiveRecord` / `setObjectiveRecord` methods — the same contract SE4's
 * session manager uses.
 *
 * @internal
 */

import type { ConversationStorageAdapter } from "../../../types/conversation-storage.js";
import type {
  DurableGoalOptions,
  ObjectiveRecord,
  ObjectiveStatus,
} from "../../../types/objective.js";

/** True iff the adapter can persist objective records. */
function canPersist(
  a: ConversationStorageAdapter,
): a is ConversationStorageAdapter &
  Required<Pick<ConversationStorageAdapter, "getObjectiveRecord" | "setObjectiveRecord">> {
  return typeof a.getObjectiveRecord === "function" && typeof a.setObjectiveRecord === "function";
}

/**
 * Read-modify-write the objective, preferring the adapter's ATOMIC
 * `updateObjectiveRecord` (which holds its lock across the read AND write, so
 * concurrent write-backs cannot drop turns — HIGH-1). Falls back to a
 * non-atomic get+set when the adapter omits it. `mutate` returns the next record,
 * `null` to clear, or `undefined` to leave unchanged. Callers guard `canPersist`.
 */
async function mutateObjective(
  adapter: ConversationStorageAdapter &
    Required<Pick<ConversationStorageAdapter, "getObjectiveRecord" | "setObjectiveRecord">>,
  conversationId: string,
  mutate: (current: ObjectiveRecord | undefined) => ObjectiveRecord | null | undefined,
): Promise<void> {
  if (typeof adapter.updateObjectiveRecord === "function") {
    await adapter.updateObjectiveRecord(conversationId, mutate);
    return;
  }
  const current = await adapter.getObjectiveRecord(conversationId);
  const next = mutate(current);
  if (next === undefined) return;
  await adapter.setObjectiveRecord(conversationId, next);
}

/** Read the durable objective for `conversationId`, or `undefined` (unset / unsupported). */
export async function getObjective(
  adapter: ConversationStorageAdapter,
  conversationId: string,
): Promise<ObjectiveRecord | undefined> {
  if (!canPersist(adapter)) return undefined;
  return adapter.getObjectiveRecord(conversationId);
}

/** Set a FRESH objective (status `active`, `runsUsed` 0). Overwrites any prior record. */
export async function setObjective(
  adapter: ConversationStorageAdapter,
  conversationId: string,
  objective: string,
  options?: DurableGoalOptions,
): Promise<void> {
  if (!canPersist(adapter)) return;
  const record: ObjectiveRecord = {
    _schemaVersion: 1,
    objective,
    ...(options !== undefined ? { options } : {}),
    status: "active",
    runsUsed: 0,
  };
  await adapter.setObjectiveRecord(conversationId, record);
}

/**
 * Merge `patch` into the active objective's `options` (only provided fields
 * change). No-op when no objective is set. Keeps `objective` / `status` /
 * `runsUsed` unchanged. Atomic read-modify-write via {@link mutateObjective}.
 */
export async function updateObjectiveOptions(
  adapter: ConversationStorageAdapter,
  conversationId: string,
  patch: DurableGoalOptions,
): Promise<void> {
  if (!canPersist(adapter)) return;
  await mutateObjective(adapter, conversationId, (current) =>
    current === undefined ? undefined : { ...current, options: { ...current.options, ...patch } },
  );
}

/**
 * Write back loop progress (`runsUsed` + `status`) after a `runUntil` pass. No-op
 * when unset. Atomic read-modify-write via {@link mutateObjective} — the read that
 * feeds the increment happens under the adapter's lock, so concurrent write-backs
 * on one thread cannot drop turns (HIGH-1).
 */
export async function writeObjectiveProgress(
  adapter: ConversationStorageAdapter,
  conversationId: string,
  progress: { runsUsed: number; status: ObjectiveStatus },
): Promise<void> {
  if (!canPersist(adapter)) return;
  await mutateObjective(adapter, conversationId, (current) =>
    current === undefined
      ? undefined
      : { ...current, runsUsed: progress.runsUsed, status: progress.status },
  );
}

/** Clear the durable objective for `conversationId`. */
export async function clearObjective(
  adapter: ConversationStorageAdapter,
  conversationId: string,
): Promise<void> {
  if (!canPersist(adapter)) return;
  await adapter.setObjectiveRecord(conversationId, null);
}
