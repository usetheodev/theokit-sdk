/**
 * T4.1 — end-to-end wiring proof: a real `defineTool({ sanitize })` custom tool fed loose,
 * model-shaped args (leading newlines + string-encoded number) delivers clean, typed input to the
 * handler. Exercises the public primitive (`@theokit/sdk/sanitize`) + the `defineTool` opt-in +
 * schema-aware coercion together, the way an SDK consumer would use it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../src/define-tool.js";
import { sanitizeToolInput } from "../../src/sanitize/index.js";

describe("sanitize — end-to-end", () => {
  it("test_end_to_end_defineTool_sanitize", async () => {
    let received: unknown;
    const tool = defineTool({
      name: "read_lines",
      description: "read N lines from a file",
      inputSchema: z.object({ path: z.string(), n: z.number() }),
      sanitize: { coerce: true },
      handler: (input) => {
        received = input;
        return `read ${input.n} from ${input.path}`;
      },
    });

    // Loose model output: path wrapped in newlines, count as a string.
    const out = await tool.handler({ path: "\nsrc/index.ts\n", n: "5" } as unknown as Record<
      string,
      unknown
    >);

    expect(received).toEqual({ path: "src/index.ts", n: 5 });
    expect(out).toBe("read 5 from src/index.ts");
  });

  it("test_public_primitive_reachable_from_barrel", () => {
    const r = sanitizeToolInput({ p: " a.ts " });
    expect(r.value).toEqual({ p: "a.ts" });
  });
});
