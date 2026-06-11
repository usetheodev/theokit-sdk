/**
 * T3.6 — OpenAI native structured outputs via `response_format: {type:
 * "json_schema", json_schema}`. Pre-T3.6 the SDK had no way to opt into
 * OpenAI's native structured outputs; consumers had to fall back to
 * `Agent.generateObject`'s synthetic forced-tool path (ADR D33) even when
 * the provider supported the native API.
 *
 * Native structured outputs:
 *  - Provider guarantees response matches the schema (no parse retries).
 *  - Lower latency (no extra tool round-trip).
 *  - Supported by `gpt-4o-2024-08-06` and later, plus OpenRouter passthrough.
 *
 * Plan T3.6: widen `LlmRequest` with `responseFormat?: LlmResponseFormat`,
 * and emit it in `buildOpenAIBody`. `Agent.generateObject` prefers this
 * path when the provider is OpenAI-compatible.
 */

import { describe, expect, it } from "vitest";

import { __testing__buildOpenAIBody } from "../../../src/internal/llm/openai.js";
import type { LlmRequest } from "../../../src/internal/llm/types.js";

const SAMPLE_SCHEMA = {
  type: "object",
  properties: {
    city: { type: "string" },
    country: { type: "string" },
  },
  required: ["city", "country"],
  additionalProperties: false,
};

describe("T3.6 — OpenAI structured outputs (json_schema) emission", () => {
  it("omits response_format when LlmRequest.responseFormat is undefined", () => {
    const req: LlmRequest = {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = __testing__buildOpenAIBody(req);
    expect(body.response_format).toBeUndefined();
  });

  it("emits response_format.type === 'json_schema' for native shape", () => {
    const req: LlmRequest = {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: "Location",
          schema: SAMPLE_SCHEMA,
          strict: true,
        },
      },
    };
    const body = __testing__buildOpenAIBody(req);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "Location",
        schema: SAMPLE_SCHEMA,
        strict: true,
      },
    });
  });

  it("emits response_format.type === 'json_object' for legacy shape", () => {
    const req: LlmRequest = {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      responseFormat: { type: "json_object" },
    };
    const body = __testing__buildOpenAIBody(req);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("defaults strict to true when omitted", () => {
    const req: LlmRequest = {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: "Bare", schema: { type: "object" } },
      },
    };
    const body = __testing__buildOpenAIBody(req);
    const rf = body.response_format as { json_schema: { strict?: boolean } };
    expect(rf.json_schema.strict).toBe(true);
  });
});
