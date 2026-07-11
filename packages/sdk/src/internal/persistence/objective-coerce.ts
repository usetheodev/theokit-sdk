/**
 * SE33 (ADR 0012) — coerce an untrusted parsed JSON value into an
 * {@link ObjectiveRecord}, or `undefined` when the shape is not a valid record.
 * Malformed JSON is caught upstream (the reader distinguishes ENOENT); this
 * guards against a structurally-wrong but valid-JSON file.
 *
 * @internal
 */

import type {
  DurableGoalOptions,
  ObjectiveRecord,
  ObjectiveStatus,
} from "../../types/objective.js";

const STATUSES: readonly ObjectiveStatus[] = ["active", "done", "paused"];

function coerceOptions(raw: unknown): DurableGoalOptions | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const out: { maxRuns?: number; judgeModel?: string; prompt?: string } = {};
  if (typeof o.maxRuns === "number") out.maxRuns = o.maxRuns;
  if (typeof o.judgeModel === "string") out.judgeModel = o.judgeModel;
  if (typeof o.prompt === "string") out.prompt = o.prompt;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function coerceObjectiveRecord(raw: unknown): ObjectiveRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (o._schemaVersion !== 1) return undefined;
  if (typeof o.objective !== "string") return undefined;
  if (typeof o.runsUsed !== "number") return undefined;
  if (typeof o.status !== "string" || !STATUSES.includes(o.status as ObjectiveStatus))
    return undefined;
  const options = coerceOptions(o.options);
  return {
    _schemaVersion: 1,
    objective: o.objective,
    ...(options !== undefined ? { options } : {}),
    status: o.status as ObjectiveStatus,
    runsUsed: o.runsUsed,
  };
}
