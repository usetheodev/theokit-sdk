/**
 * Adversarial property tests for repair-middleware (T5.1).
 * 4 properties × 200 runs = 800+ random inputs.
 */

import fc from "fast-check";
import { describe, it } from "vitest";

import {
  type RepairableTool,
  repairToolCall,
  type ToolCall,
} from "../../../src/internal/tool-dispatch/repair-middleware.js";

function buildRegistry(names: string[]): ReadonlyMap<string, RepairableTool> {
  return new Map(
    names.map((n) => [
      n,
      {
        name: n,
        inputSchema: {
          properties: {
            count: { type: "number" },
            flag: { type: "boolean" },
            tag: { type: "string" },
          },
        },
      },
    ]),
  );
}

describe("repair-middleware — property invariants (T5.1)", () => {
  it("idempotent — repair(repair(x)) produces no new repairs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 8 }),
          fc.oneof(fc.string(), fc.integer()),
        ),
        (name, args) => {
          const registry = buildRegistry(["search", "fetch", "limit"]);
          const raw: ToolCall = { name, args, id: "1" };
          const r1 = repairToolCall(raw, registry);
          const r2 = repairToolCall(r1.call, registry);
          // Second pass should produce no NEW repairs.
          return r2.repairs.length === 0;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("case-insensitive match resolves uppercased names", () => {
    fc.assert(
      fc.property(fc.constantFrom("search", "fetch", "limit", "tool_a", "do_thing"), (name) => {
        const registry = buildRegistry([name]);
        const result = repairToolCall({ name: name.toUpperCase(), args: {}, id: "1" }, registry);
        return result.call.name === name;
      }),
      { numRuns: 200 },
    );
  });

  it("raw input is never mutated", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string()),
        (name, args) => {
          const registry = buildRegistry(["search"]);
          const raw: ToolCall = { name, args: { ...args }, id: "1" };
          const beforeJson = JSON.stringify(raw);
          repairToolCall(raw, registry);
          const afterJson = JSON.stringify(raw);
          return beforeJson === afterJson;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("JSON-string args parsed when registry tool found", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9]*$/), fc.oneof(fc.string(), fc.integer())),
        (argObj) => {
          const registry = buildRegistry(["search"]);
          const stringified = JSON.stringify(argObj);
          const result = repairToolCall({ name: "search", args: stringified, id: "1" }, registry);
          // After parsing, args should be the original object (string→object).
          return typeof result.call.args === "object" && result.call.args !== null;
        },
      ),
      { numRuns: 200 },
    );
  });
});
