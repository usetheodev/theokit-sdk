/**
 * Shared tools definitions and utilities.
 * Canonical implementation (consolidated from 414L duplicate in 2 locations).
 * Re-exported by packages that need it.
 * @internal
 */

export function createDefaultTools() {
  return [
    {
      name: "search",
      description: "Search tool",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

export function validateToolDefinition(tool: any) {
  if (!tool.name) throw new Error("Tool must have a name");
  if (!tool.description) throw new Error("Tool must have a description");
  if (!tool.inputSchema) throw new Error("Tool must have inputSchema");
  return true;
}
