import { describe, expect, it } from "vitest";
import { ConfigurationError, TheokitAgentError } from "../../../src/errors.js";
import type { LoopContext } from "../../../src/internal/agent-loop/loop-context-init.js";
import { registerLoopError } from "../../../src/internal/agent-loop/loop-llm-stream.js";
import { mapAnthropicError } from "../../../src/internal/error-mappers/anthropic.js";
import { mapOpenAICompatibleError } from "../../../src/internal/error-mappers/openai-compatible.js";

/** Minimal LoopContext stub — registerLoopError only reads/writes `ctx.error`. */
function ctxStub(): LoopContext {
  return { error: undefined } as unknown as LoopContext;
}

const CONTEXT_BODY = {
  error: { message: "prompt is too long: 250000 tokens > 200000 context length" },
};

describe("registerLoopError — canonical code at the boundary (M2-3)", () => {
  it("test_prefers_metadata_code_over_prefixed_top_level", () => {
    const ctx = ctxStub();
    registerLoopError(
      ctx,
      new ConfigurationError("boom", {
        code: "anthropic_context_too_long",
        metadata: { provider: "anthropic", code: "context_too_long" } as never,
      }),
    );
    expect(ctx.error?.code).toBe("context_too_long");
  });

  it("test_400_context_overflow_surfaces_canonical_code", () => {
    const ctx = ctxStub();
    registerLoopError(
      ctx,
      mapAnthropicError({
        status: 400,
        body: CONTEXT_BODY,
        headers: undefined,
        endpoint: "/v1/messages",
      }),
    );
    expect(ctx.error?.code).toBe("context_too_long");
  });

  it("test_400_context_overflow_openai_compatible_surfaces_canonical", () => {
    const ctx = ctxStub();
    registerLoopError(
      ctx,
      mapOpenAICompatibleError({
        providerId: "openrouter",
        status: 400,
        // openai-compatible maps via the structured error.code, not message text
        body: { error: { code: "context_length_exceeded", message: "too long" } },
        headers: undefined,
        endpoint: "/v1/chat/completions",
      }),
    );
    expect(ctx.error?.code).toBe("context_too_long");
  });

  it("test_falls_back_to_top_level_code_when_no_metadata", () => {
    const ctx = ctxStub();
    registerLoopError(ctx, new TheokitAgentError("boom", { code: "budget" }));
    expect(ctx.error?.code).toBe("budget");
  });

  it("test_no_code_when_neither_present", () => {
    const ctx = ctxStub();
    registerLoopError(ctx, new Error("boom"));
    expect(ctx.error?.code).toBeUndefined();
    expect(ctx.error?.message).toBe("boom");
  });

  it("test_non_string_metadata_code_falls_back", () => {
    const ctx = ctxStub();
    registerLoopError(ctx, { message: "boom", code: "x", metadata: { code: 123 } });
    expect(ctx.error?.code).toBe("x");
  });

  it("test_set_once_first_error_wins", () => {
    const ctx = ctxStub();
    registerLoopError(ctx, new TheokitAgentError("first", { code: "rate_limit" }));
    registerLoopError(ctx, new TheokitAgentError("second", { code: "context_too_long" }));
    expect(ctx.error?.message).toBe("first");
    expect(ctx.error?.code).toBe("rate_limit");
  });
});
