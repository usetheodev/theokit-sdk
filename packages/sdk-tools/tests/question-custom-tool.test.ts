/**
 * M76 T1.1 — `createQuestionTool` starts returning the canonical contract.
 *
 * ## The delta is ONE field
 *
 * `QuestionTool` was its own interface with `inputSchema: unknown`, while `CustomTool` declares
 * `inputSchema: Record<string, unknown>`. Name, description and handler were already structurally
 * compatible — a 1-argument handler satisfies a type with 2 optional arguments.
 *
 * Narrowing is **additive**: the runtime value has ALWAYS been an object (the implementation builds
 * `{ type: "object", properties: {...}, required: ["question"] }`); only the declared type was loose.
 * It would only break callers passing a non-object, which the factory never produces.
 *
 * ## Why this matters outside the SDK
 *
 * The consumer was forced to write TWO casts to register the tool
 * (`agent-builder/agents/chat.ts:94-95`). A cast is the signature of a contract that does not close: it does not
 * fix the type, it only silences the compiler — and silencing here means a signature change
 * in the SDK would reach the consumer as a runtime error, not a compile error.
 *
 * ## What vitest does NOT prove here
 *
 * Compatibility is a TYPE fact. Vitest transpiles without checking types, so the assignment test
 * below would pass even with the contract broken — `tsc --noEmit` is what proves it, and the task's AC
 * requires a green `tsc` for that reason. It was a mistake made three times in M75; here it is written down.
 */
import { describe, expect, it } from "vitest";

import { createQuestionTool } from "../src/question.js";

const fakeAsker = async (): Promise<string> => "answer";

describe("M76 T1.1 — the question contract closes with no cast", () => {
  it("test_input_schema_is_an_object_at_runtime", () => {
    // The basis of the argument that narrowing is additive: the value ALREADY is what the narrow type declares.
    const t = createQuestionTool({ askUser: fakeAsker });
    const schema = t.inputSchema as Record<string, unknown>;
    expect(typeof schema).toBe("object");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["question"]);
  });

  it("test_the_schema_is_indexable_as_a_record", () => {
    // `unknown` is not indexable; `Record<string, unknown>` is. This test fails at COMPILE time with the
    // old type — and it is that failure, not the execution, that proves the change.
    const t = createQuestionTool({ askUser: fakeAsker });
    const props = t.inputSchema.properties;
    expect(props).toBeDefined();

    // M76 review (M5) — `toBeDefined()` alone passes with `properties: {}`. The `question` key is the
    // contract: the handler reads `input.question`, so a schema without that key produces a tool the
    // model always calls with no argument. Indexing is what proves the type AND the shape at once.
    expect(Object.keys(props as Record<string, unknown>)).toContain("question");
    expect(t.inputSchema.required).toEqual(["question"]);
  });

  it("test_a_one_argument_handler_is_still_valid", () => {
    // Handler backward compatibility: callers passing 1 argument are unaffected. The 2nd (`ctx`) is optional.
    const t = createQuestionTool({ askUser: fakeAsker });
    expect(t.handler.length).toBeLessThanOrEqual(2);
  });

  it("test_name_and_description_follow_todays_defaults", () => {
    // ANCHOR: if the promotion changed the default silently, the model would see a different tool and
    // approvals recorded by name would stop matching. The name is a contract, not a label (blueprint Q1).
    const t = createQuestionTool({ askUser: fakeAsker });
    expect(t.name).toBe("question");
    expect(t.description).toContain("Ask the user a question");
  });
});
