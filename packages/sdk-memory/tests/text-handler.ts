import type { ToolResultContentBlock } from "@theokit/sdk";

/**
 * SE7 — a tool `handler` may now return `string | ToolResultContentBlock[]`.
 * The memory tools return strings; this generic helper narrows any tool's
 * handler to `(input) => Promise<string>` (preserving its input type) so
 * string-oriented assertions typecheck, and fails loud if one returns blocks.
 */
export function textHandler<I>(tool: {
  handler: (
    input: I,
  ) => string | ToolResultContentBlock[] | Promise<string | ToolResultContentBlock[]>;
}): (input: I) => Promise<string> {
  return async (input: I) => {
    const out = await tool.handler(input);
    if (typeof out !== "string") {
      throw new Error(`expected a string tool result, got structured content blocks`);
    }
    return out;
  };
}
