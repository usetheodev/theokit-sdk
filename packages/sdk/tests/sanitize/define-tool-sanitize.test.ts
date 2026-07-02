/**
 * T2.1 — `defineTool({ sanitize })` opt-in. Sanitize runs on the raw args BEFORE `inputSchema.parse`
 * so trimmed/coerced model output satisfies the tool's own Zod schema. Absent `sanitize` ⇒ the
 * handler path is byte-identical to today (the golden guard).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../src/define-tool.js";

describe("defineTool({ sanitize })", () => {
  it("test_sanitize_absent_is_identical_behavior", async () => {
    let received: unknown;
    const tool = defineTool({
      name: "t",
      description: "d",
      inputSchema: z.object({ path: z.string() }),
      handler: (input) => {
        received = input;
        return "ok";
      },
    });
    // No sanitize: a string with leading/trailing newlines is still a valid string, so it reaches
    // the handler UNTRIMMED — identical to the pre-sanitize behaviour.
    await tool.handler({ path: "\na.ts\n" });
    expect(received).toEqual({ path: "\na.ts\n" });
  });

  it("test_sanitize_true_trims_then_parses", async () => {
    let received: unknown;
    const tool = defineTool({
      name: "t",
      description: "d",
      inputSchema: z.object({ path: z.string() }),
      sanitize: true,
      handler: (input) => {
        received = input;
        return "ok";
      },
    });
    await tool.handler({ path: "\na.ts\n" });
    expect(received).toEqual({ path: "a.ts" });
  });

  it("test_sanitize_coerce_lets_string_number_pass_number_schema", async () => {
    let received: unknown;
    const tool = defineTool({
      name: "t",
      description: "d",
      inputSchema: z.object({ n: z.number() }),
      sanitize: { coerce: true },
      handler: (input) => {
        received = input;
        return "ok";
      },
    });
    // Without coercion, z.number().parse("5") throws; with schema-aware coerce, "5" → 5 passes.
    await tool.handler({ n: "5" } as unknown as Record<string, unknown>);
    expect(received).toEqual({ n: 5 });
  });

  it("test_sanitize_does_not_bypass_genuine_validation", async () => {
    const tool = defineTool({
      name: "t",
      description: "d",
      inputSchema: z.object({ req: z.string() }),
      sanitize: true,
      handler: () => "ok",
    });
    // Sanitize is hygiene, not a validity bypass — a genuinely missing field still throws ZodError.
    await expect(tool.handler({})).rejects.toThrow();
  });
});
