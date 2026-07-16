/**
 * `BudgetTracker` and companion contract types.
 *
 * The contract now lives in the domain `types/` layer (SE46 DIP direction):
 * `types/budget-tracker.ts` owns the interfaces; this application-layer module
 * re-exports them so existing importers (agent-loop, counter impl, index.ts)
 * keep resolving the same names.
 *
 * @public — surface-level interface; impl is internal-but-replaceable.
 */

export type {
  BudgetCheck,
  BudgetTotal,
  BudgetTracker,
  BudgetUsageEvent,
} from "../../../types/budget-tracker.js";
