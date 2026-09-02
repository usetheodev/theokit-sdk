import { describe, expect, it } from "vitest";
import { z } from "zod";
// SE36 — the new uniform namespace API. `Tool.create` replaces `defineTool` (hard break).
import { Tool } from "../src/define-tool.js";

/**
 * SE36 parity — `Tool.create(spec)` MUST produce a `CustomTool` structurally identical to the
 * one the removed `defineTool(spec)` produced. Behavior is unchanged by contract (ADR 0015 /
 * ADR-B1: the class wraps the retained implementation).
 */
describe("SE36 — Tool.create (was defineTool)", () => {
  it("produces a CustomTool with the spec's name/description and a JSON-schema input", () => {
    const t = Tool.create({
      name: "get_weather",
      description: "Look up the weather.",
      inputSchema: z.object({ city: z.string() }),
      handler: ({ city }) => `sunny in ${city}`,
    });
    expect(t.name).toBe("get_weather");
    expect(t.description).toBe("Look up the weather.");
    expect(typeof t.handler).toBe("function");
    expect(t.inputSchema).toMatchObject({ type: "object" });
  });

  it("runs the handler with parsed, typed input", async () => {
    const t = Tool.create({
      name: "echo",
      description: "echo the city",
      inputSchema: z.object({ city: z.string() }),
      handler: ({ city }) => `[${city}]`,
    });
    const out = await t.handler({ city: "Tokyo" });
    expect(out).toBe("[Tokyo]");
  });

  it("is a namespace (private constructor): `new Tool()` is a compile error", () => {
    // The guard is compile-time — `@ts-expect-error` fails the build if `new Tool()`
    // ever becomes assignable. `Tool.create` is the only construction path.
    // @ts-expect-error — private constructor.
    const _neverConstructedThisWay = () => new Tool();
    expect(typeof Tool.create).toBe("function");
  });
});
