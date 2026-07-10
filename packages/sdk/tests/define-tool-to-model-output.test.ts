import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "../src/define-tool.js";

/**
 * SE17 — `defineTool` gains an optional `toModelOutput`. The handler returns the
 * FULL structured result (validated by SE16's `outputSchema`); `toModelOutput`
 * maps it to the compact / multimodal representation the MODEL sees in the
 * tool_result. Mirrors a peer framework `toModelOutput` + the a peer framework.
 */
describe("defineTool toModelOutput (SE17)", () => {
  it("maps the full output to the compact model-facing tool result", async () => {
    const tool = defineTool({
      name: "weather",
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ location: z.string(), temp: z.number(), icon: z.string() }),
      handler: () => ({ location: "SF", temp: 68, icon: "http://icon.png" }),
      toModelOutput: (o) => `${o.location}: ${o.temp}F`,
    });
    const result = await tool.handler({ city: "SF" });
    // The model sees ONLY the compact string — not the full JSON (no `icon`).
    expect(result).toBe("SF: 68F");
    expect(result).not.toContain("icon");
  });

  it("supports a multimodal (blocks) model-facing output", async () => {
    const tool = defineTool({
      name: "weather",
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ location: z.string(), icon: z.string() }),
      handler: () => ({ location: "SF", icon: "http://icon.png" }),
      toModelOutput: (o) => [
        { type: "text", text: o.location },
        { type: "image", source: { type: "base64", media_type: "image/png", data: o.icon } },
      ],
    });
    const result = await tool.handler({ city: "SF" });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("works without outputSchema (shapes the string handler return)", async () => {
    const tool = defineTool({
      name: "echo",
      description: "Echo",
      inputSchema: z.object({ text: z.string() }),
      handler: (input) => input.text,
      toModelOutput: (s) => `shaped: ${s}`,
    });
    expect(await tool.handler({ text: "hi" })).toBe("shaped: hi");
  });

  it("a throwing toModelOutput propagates (converted to tool_result(isError) by the dispatch)", async () => {
    const tool = defineTool({
      name: "weather",
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ temp: z.number() }),
      handler: () => ({ temp: 20 }),
      toModelOutput: () => {
        throw new Error("map boom");
      },
    });
    await expect(tool.handler({ city: "SF" })).rejects.toThrow("map boom");
  });

  it("without toModelOutput the SE16 serialization is unchanged", async () => {
    const tool = defineTool({
      name: "weather",
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ temp: z.number() }),
      handler: () => ({ temp: 20 }),
    });
    const result = (await tool.handler({ city: "SF" })) as string;
    expect(JSON.parse(result)).toEqual({ temp: 20 });
  });
});
