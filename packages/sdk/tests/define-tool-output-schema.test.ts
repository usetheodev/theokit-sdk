import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Tool } from "../src/define-tool.js";

/**
 * SE16 — `Tool` gains an optional `outputSchema`. When set, the handler
 * returns the STRUCTURED output (inferred from the schema), it is validated, and
 * the tool_result becomes its serialization (string as-is; object JSON-stringified).
 * When absent, the handler returns a string exactly as before (back-compat).
 * Mirrors a peer framework `createTool`'s `outputSchema`.
 */
describe("Tool outputSchema (SE16)", () => {
  it("validates the structured return and serializes it to the tool result", async () => {
    const tool = Tool.create({
      name: "weather",
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ temp: z.number(), cond: z.string() }),
      handler: (input) => {
        expect(input.city).toBe("SF"); // input inference still works
        return { temp: 20, cond: "sunny" };
      },
    });
    // Tool always resolves to a string; CustomTool.handler's wider union needs a narrow.
    const result = (await tool.handler({ city: "SF" })) as string;
    expect(JSON.parse(result)).toEqual({ temp: 20, cond: "sunny" });
  });

  it("surfaces a typed error when the structured return fails outputSchema validation", async () => {
    const tool = Tool.create({
      name: "weather",
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ temp: z.number() }),
      // biome-ignore lint/suspicious/noExplicitAny: intentionally returning an invalid shape for the negative case.
      handler: () => ({ temp: "not-a-number" }) as any,
    });
    // Measured: the ZodError the trailing comment already claimed, now asserted rather than noted.
    await expect(tool.handler({ city: "SF" })).rejects.toThrow(/"expected": "number"/);
  });

  it("a string outputSchema returns the string as-is (not JSON-quoted)", async () => {
    const tool = Tool.create({
      name: "echo",
      description: "Echo",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      handler: (input) => input.text,
    });
    expect(await tool.handler({ text: "hello" })).toBe("hello");
  });

  it("JSON.stringifies a non-string primitive output (z.number())", async () => {
    const tool = Tool.create({
      name: "temp",
      description: "Number schema",
      inputSchema: z.object({}),
      outputSchema: z.number(),
      handler: () => 42,
    });
    expect(await tool.handler({})).toBe("42");
  });

  it("an async handler with outputSchema is validated and serialized", async () => {
    const tool = Tool.create({
      name: "async-weather",
      description: "Async structured output",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.object({ temp: z.number() }),
      handler: async () => ({ temp: 99 }),
    });
    expect(JSON.parse((await tool.handler({ city: "LA" })) as string)).toEqual({ temp: 99 });
  });

  it("without outputSchema the handler returns a string exactly as before (back-compat)", async () => {
    const tool = Tool.create({
      name: "plain",
      description: "Plain",
      inputSchema: z.object({}),
      handler: () => "plain string",
    });
    expect(await tool.handler({})).toBe("plain string");
  });
});
