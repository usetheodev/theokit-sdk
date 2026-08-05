/**
 * Public types for the judge subsystem (T2.1, ADR D120).
 *
 * @internal
 */

// M80 — the canonical definition of `Verdict`/`JudgeResult` lives in `types/goal-events.ts` (the public
// surface). Here it merely passes through, so internal code need not change imports and so there are not
// two declarations of the same shape.
export type { JudgeResult, Verdict } from "../../types/goal-events.js";
