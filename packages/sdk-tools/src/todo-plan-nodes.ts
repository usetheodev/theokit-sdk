import type { TodoItem } from "./todolist.js";

/**
 * A flat plan-render node — the stable shape a UI/plan layer consumes. Mirrors
 * the `TodoItem` status union; `label` is the item title.
 *
 * @public
 */
export interface PlanNode {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "done";
}

/**
 * Convert structured todo items (from a `todolist` tool result's `items`, M4-5)
 * into versioned `PlanNode`s for rendering. Pure: projects EXACTLY
 * `{ id, label, status }` (timestamps are intentionally dropped), preserving
 * input order. Replaces consumer-side hand-rolled mappers.
 *
 * @public
 */
export function todoItemsToPlanNodes(items: readonly TodoItem[]): PlanNode[] {
  return items.map((item) => ({ id: item.id, label: item.title, status: item.status }));
}
