/**
 * Step-cap force-close (SDK layer): `LlmRequest.toolChoice` maps to the OpenAI/OpenRouter
 * `tool_choice` body field. `"none"` forces a text answer even when `tools` are advertised — the
 * agent loop sets it on a ceiling round to force a closing summary from a cached agent (whose tools
 * cannot be un-registered). `tool_choice` is only meaningful alongside `tools`, so it is emitted
 * only when both are present.
 */
import { describe, expect, it } from "vitest";
import { __testing__buildOpenAIBody } from "../../../src/internal/llm/openai.js";
import type { LlmRequest, LlmTool } from "../../../src/internal/llm/types.js";

const tool: LlmTool = { name: "read", description: "read a file", inputSchema: { type: "object" } };
const baseReq: LlmRequest = {
  model: "deepseek/deepseek-v3.2",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [tool],
};

describe("step-cap force-close — tool_choice request body", () => {
  it("test_buildOpenAIBody_forwards_tool_choice_none", () => {
    const body = __testing__buildOpenAIBody({ ...baseReq, toolChoice: "none" });
    expect(body.tool_choice).toBe("none");
    expect(body.tools).toBeDefined(); // tools still advertised — the gate, not removal
  });

  it("test_buildOpenAIBody_forwards_tool_choice_required", () => {
    const body = __testing__buildOpenAIBody({ ...baseReq, toolChoice: "required" });
    expect(body.tool_choice).toBe("required");
  });

  it("test_buildOpenAIBody_omits_tool_choice_when_absent", () => {
    expect(__testing__buildOpenAIBody(baseReq).tool_choice).toBeUndefined();
  });

  it("test_buildOpenAIBody_omits_tool_choice_when_no_tools", () => {
    // tool_choice is meaningless without a tools array — never emit it alone.
    const body = __testing__buildOpenAIBody({ ...baseReq, tools: [], toolChoice: "none" });
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });
});
