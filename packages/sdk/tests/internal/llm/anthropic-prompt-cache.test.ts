/**
 * T3.5 — `LlmRequest.system` widened from `string` to `string | LlmSystemBlock[]`
 * and `buildAnthropicCommonBody` emits Anthropic prompt-caching shape when
 * the caller passes blocks with `cacheable: true`.
 *
 * Pre-T3.5 the SDK could only pass a single system string, so consumers had
 * no way to opt into Anthropic's prompt caching (which requires the
 * `cache_control: {type: 'ephemeral'}` annotation on individual content
 * blocks). Static-prompt apps re-paid the full input-token cost on every
 * request even though Anthropic billing would have charged a 1-3 cache_read
 * factor.
 *
 * Plan T3.5: widen the type, route the new shape through
 * `anthropic-shared.ts:166-186`, preserve back-compat for the string form.
 */

import { describe, expect, it } from "vitest";

import { buildAnthropicCommonBody } from "../../../src/internal/llm/anthropic-shared.js";
import type { LlmRequest } from "../../../src/internal/llm/types.js";

describe("T3.5 — Anthropic prompt-cache emit + LlmRequest.system widening", () => {
  it("string system is forwarded verbatim (back-compat)", () => {
    const req: LlmRequest = {
      model: "claude",
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = buildAnthropicCommonBody(req);
    expect(body.system).toBe("You are a helpful assistant.");
  });

  it("array of blocks is converted to Anthropic content-block array", () => {
    const req: LlmRequest = {
      model: "claude",
      system: [
        { text: "You are an expert in TypeScript.", cacheable: true },
        { text: "Answer briefly.", cacheable: false },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = buildAnthropicCommonBody(req);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(2);
  });

  it("cacheable: true emits cache_control { type: 'ephemeral' }", () => {
    const req: LlmRequest = {
      model: "claude",
      system: [{ text: "Cacheable block content.", cacheable: true }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = buildAnthropicCommonBody(req);
    const blocks = body.system as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({
      type: "text",
      text: "Cacheable block content.",
      cache_control: { type: "ephemeral" },
    });
  });

  it("cacheable: false omits cache_control (only `type` + `text`)", () => {
    const req: LlmRequest = {
      model: "claude",
      system: [{ text: "Non-cacheable block." }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = buildAnthropicCommonBody(req);
    const blocks = body.system as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: "text", text: "Non-cacheable block." });
    expect(blocks[0]?.cache_control).toBeUndefined();
  });

  it("empty array short-circuits to omitted system", () => {
    const req: LlmRequest = {
      model: "claude",
      system: [],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const body = buildAnthropicCommonBody(req);
    expect(body.system).toBeUndefined();
  });
});
