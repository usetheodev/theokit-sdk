import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "../../../src/index.js";

/**
 * Golden tests for {@link defineTool} — Phase 3 of the agent construction DX
 * helpers plan (ADR D24). Covers JSON Schema conversion, runtime parse,
 * type inference (compile-time), error propagation, and transform handling.
 */

describe("defineTool", () => {
  it("returns a valid CustomTool with object inputSchema", () => {
    const tool = defineTool({
      name: "echo",
      description: "Echo the input.",
      inputSchema: z.object({ text: z.string() }),
      handler: (input) => `echo: ${input.text}`,
    });
    expect(tool.name).toBe("echo");
    expect(tool.description).toBe("Echo the input.");
    expect(tool.inputSchema).toEqual(expect.objectContaining({ type: "object" }));
    expect(typeof tool.handler).toBe("function");
  });

  it("parses input at runtime via the Zod schema before invoking the handler", async () => {
    let receivedRaw: unknown;
    const tool = defineTool({
      name: "with_parse",
      description: "Parse-then-call.",
      inputSchema: z.object({ n: z.number().int() }),
      handler: (input) => {
        receivedRaw = input;
        return `n=${input.n}`;
      },
    });
    // Valid input — handler runs with parsed type
    const ok = await tool.handler({ n: 7 });
    expect(ok).toBe("n=7");
    expect(receivedRaw).toEqual({ n: 7 });
    // Invalid input — Zod parse throws; tool-dispatch upstream converts to
    // tool_result(isError). Here we just assert the throw surfaces.
    await expect(tool.handler({ n: "not-a-number" })).rejects.toThrow();
  });

  it("propagates handler throws unchanged", async () => {
    const tool = defineTool({
      name: "thrower",
      description: "Always throws.",
      inputSchema: z.object({}),
      handler: () => {
        throw new Error("boom");
      },
    });
    await expect(tool.handler({})).rejects.toThrow(/boom/);
  });

  it("infers the handler input type from the schema (compile-time check)", () => {
    // TS-level test: handler arg is { count: number }, not Record<string, unknown>.
    const tool = defineTool({
      name: "typed_input",
      description: "Handler arg type is inferred.",
      inputSchema: z.object({ count: z.number() }),
      // If type inference broke, this assignment would error at tsc:
      handler: (input: { count: number }): string => `count=${input.count}`,
    });
    expect(tool.name).toBe("typed_input");
  });

  it("rejected by validateCustomTools when schema declares non-object root", async () => {
    const { Agent } = await import("../../../src/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "theokit-definetool-bad-"));
    // Using z.string() at the root produces inputSchema with type: "string",
    // which our validateCustomTools rejects with tool_invalid_schema_type.
    const tool = defineTool({
      name: "bad_schema_root",
      description: "Non-object root schema.",
      inputSchema: z.string() as never,
      handler: (input) => `got: ${input}`,
    });
    await expect(
      Agent.create({
        apiKey: "theo_test_dx_helpers",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [tool],
      }),
    ).rejects.toThrow();
  });

  it("handler receives Zod transform output type (EC-3)", async () => {
    let received: number | undefined;
    const tool = defineTool({
      name: "transform_output",
      description: "Transform string to number before handler runs.",
      inputSchema: z.object({
        port: z.string().transform((s) => Number(s)),
      }),
      handler: (input) => {
        received = input.port;
        return `port=${input.port}`;
      },
    });
    const result = await tool.handler({ port: "8080" });
    expect(result).toBe("port=8080");
    expect(received).toBe(8080); // number, not string
    expect(typeof received).toBe("number");
  });
});
