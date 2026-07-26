/**
 * Public types for the judge subsystem (T2.1, ADR D120).
 *
 * @internal
 */

// M80 — a definição canônica de `Verdict`/`JudgeResult` vive em `types/goal-events.ts` (superfície
// pública). Aqui apenas atravessa, para o código interno não precisar mudar de import e para não
// existirem duas declarações da mesma forma.
export type { JudgeResult, Verdict } from "../../types/goal-events.js";
