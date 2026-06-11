import { describe, expect, it } from "vitest";
import { createInvalidToolRepair } from "../../src/tools/invalid-repair.js";

describe("createInvalidToolRepair", () => {
  const tools = [
    { name: "read_file", description: "Read a file from the filesystem." },
    { name: "write_file", description: "Write content to a file." },
  ];

  it("returns error with list of available tools", () => {
    const repair = createInvalidToolRepair(tools);

    const result = JSON.parse(repair.handler({ toolName: "delete_file" }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_tool");
    expect(result.message).toContain("delete_file");
    expect(result.availableTools).toHaveLength(2);
    expect(result.availableTools[0].name).toBe("read_file");
  });

  it("handles missing toolName gracefully", () => {
    const repair = createInvalidToolRepair(tools);

    const result = JSON.parse(repair.handler({}));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_tool");
    expect(result.message).toContain("does not exist");
  });

  it("has correct tool metadata", () => {
    const repair = createInvalidToolRepair(tools);
    expect(repair.name).toBe("invalid_tool_repair");
    expect(repair.description).toBeTruthy();
    expect(repair.inputSchema).toBeDefined();
  });
});
