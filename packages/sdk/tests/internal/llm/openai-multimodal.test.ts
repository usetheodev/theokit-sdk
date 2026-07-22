import { describe, expect, it } from "vitest";

import { __testing__buildOpenAIBody } from "../../../src/internal/llm/openai.js";
import type { LlmRequest } from "../../../src/internal/llm/types.js";

// M35 (multimodal) — an image content part must serialize to OpenAI/OpenRouter's content-array form with
// an `image_url` data URL. Text-only turns stay a plain string (back-compat). This is the SDK layer the
// whole bridge chain feeds into; a drop here means the model never sees the image.
describe("M35 — OpenAI/OpenRouter request serializes image parts to image_url", () => {
  it("turns a user turn with an image into a content array with an image_url data URL", () => {
    const req: LlmRequest = {
      model: "openai/gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what color?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAB" } },
          ],
        },
      ],
    };
    const body = __testing__buildOpenAIBody(req, "openrouter");
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((m) => m.role === "user")!;
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<Record<string, unknown>>;
    expect(parts).toContainEqual({ type: "text", text: "what color?" });
    expect(parts).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAB" },
    });
  });

  it("keeps a text-only user turn as a plain string (back-compat)", () => {
    const req: LlmRequest = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = __testing__buildOpenAIBody(req, "openrouter");
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.find((m) => m.role === "user")!.content).toBe("hi");
  });
});
