/**
 * Barrel for tool-dispatch repair + strip-think + dispatch (ADRs D86-D89, D96).
 *
 * @internal
 */

export type { DispatchableTool, DispatchResult } from "./dispatch.js";
export { dispatchToolWithRepair } from "./dispatch.js";
export type {
  CoerceResult,
  RepairableTool,
  RepairResult,
  ToolCall,
} from "./repair-middleware.js";
export { coerceArgsToSchema, repairToolCall } from "./repair-middleware.js";
export type { ThinkStripResult } from "./strip-think.js";
export { stripThinkBlocks } from "./strip-think.js";
