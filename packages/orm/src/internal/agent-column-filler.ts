import { getTableColumns } from "drizzle-orm";
import { getAgentContext } from "../als-context.js";

const TRACKED_COLS = ["agentId", "runId", "conversationId"] as const;

const warnedTables = new WeakSet<object>();

function getTableColumnNames(table: unknown): string[] {
  if (table === null || typeof table !== "object") return [];
  try {
    return Object.keys(getTableColumns(table as Parameters<typeof getTableColumns>[0]));
  } catch {
    return [];
  }
}

export function fillAgentColumns<T extends Record<string, unknown>>(table: unknown, row: T): T {
  const columns = getTableColumnNames(table);
  const hasAnyTrackedCol = TRACKED_COLS.some((c) => columns.includes(c));
  if (!hasAnyTrackedCol) return row;

  const ctx = getAgentContext();
  if (!ctx) {
    if (
      process.env.NODE_ENV !== "production" &&
      typeof table === "object" &&
      table !== null &&
      !warnedTables.has(table)
    ) {
      warnedTables.add(table);
      console.warn(
        `[@theokit/orm] Table has agentId/runId/conversationId column(s) but no AgentContext set. Wrap calls with withAgentContext({...}, () => ...) to auto-fill.`,
      );
    }
    return row;
  }

  const filled: Record<string, unknown> = { ...row };
  for (const col of TRACKED_COLS) {
    if (columns.includes(col) && filled[col] === undefined && ctx[col] !== undefined) {
      filled[col] = ctx[col];
    }
  }
  return filled as T;
}
