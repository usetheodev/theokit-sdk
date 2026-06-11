/**
 * `invalid_tool_repair` — fallback tool invoked when the agent calls a tool that does not exist.
 *
 * Returns a helpful error listing all valid tools and their descriptions.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: false, error: "invalid_tool", message: string, availableTools: Array<{name, description}> }`
 */

export interface ToolDescriptor {
  name: string;
  description: string;
}

export interface InvalidRepairTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: { toolName?: string }) => string;
}

export function createInvalidToolRepair(availableTools: ToolDescriptor[]): InvalidRepairTool {
  return {
    name: "invalid_tool_repair",
    description: "Called when an invalid tool name is used. Returns a list of available tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        toolName: {
          type: "string",
          description: "The invalid tool name that was attempted.",
        },
      },
    },
    handler: (input: { toolName?: string }): string => {
      const toolList = availableTools.map((t) => `  - ${t.name}: ${t.description}`).join("\n");

      const attempted = input.toolName ? ` '${input.toolName}'` : "";
      const message = `Tool${attempted} does not exist. Available tools:\n${toolList}`;

      return JSON.stringify({
        ok: false,
        error: "invalid_tool",
        message,
        availableTools: availableTools.map((t) => ({ name: t.name, description: t.description })),
      });
    },
  };
}
