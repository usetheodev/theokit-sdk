import { describe, expect, it, vi } from "vitest";

import { HitlMiddleware, HitlTimeoutError } from "../src/internal/runtime/tools/hitl-middleware.js";

describe("HitlMiddleware", () => {
  it("allows unlisted tools without calling approve", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const mw = new HitlMiddleware({ tools: ["execute"], approve });
    const result = await mw.shouldProceed("readFile", { path: "/tmp" });
    expect(result).toBe(true);
    expect(approve).not.toHaveBeenCalled();
  });

  it("calls approve for listed tools", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const mw = new HitlMiddleware({ tools: ["execute"], approve });
    await mw.shouldProceed("execute", { command: "rm -rf /" });
    expect(approve).toHaveBeenCalledWith("execute", { command: "rm -rf /" });
  });

  it("returns false when approve returns false", async () => {
    const approve = vi.fn().mockResolvedValue(false);
    const mw = new HitlMiddleware({ tools: ["writeFile"], approve });
    const result = await mw.shouldProceed("writeFile", { path: "/etc/passwd" });
    expect(result).toBe(false);
  });

  it("returns true when approve returns true", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const mw = new HitlMiddleware({ tools: ["execute"], approve });
    const result = await mw.shouldProceed("execute", { command: "echo hi" });
    expect(result).toBe(true);
  });

  it("returns false on timeout (rejects)", async () => {
    const approve = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 500)));
    const mw = new HitlMiddleware({
      tools: ["execute"],
      approve,
      timeoutMs: 100,
    });
    const result = await mw.shouldProceed("execute", { command: "slow" });
    expect(result).toBe(false);
  });

  // B-141 — these two pin the CURRENT semantics of a timeout, which are not
  // obviously the right ones. They are written as characterization tests, not as
  // endorsement: if someone changes the timeout to carry its reason to the
  // caller, these should fail and be rewritten, rather than the change landing
  // silently. See the module docblock for the open question.
  it("reports an approval timeout with the same value as an explicit denial", async () => {
    // Arrange — one reviewer says no; one never answers.
    const denies = vi.fn().mockResolvedValue(false);
    const neverAnswers = vi.fn().mockImplementation(() => new Promise<boolean>(() => {}));
    const onDenial = new HitlMiddleware({ tools: ["deploy"], approve: denies, timeoutMs: 50 });
    const onTimeout = new HitlMiddleware({
      tools: ["deploy"],
      approve: neverAnswers,
      timeoutMs: 50,
    });

    // Act
    const denied = await onDenial.shouldProceed("deploy", { env: "prod" });
    const timedOut = await onTimeout.shouldProceed("deploy", { env: "prod" });

    // Assert — both false, so a caller holding the result cannot tell "a human
    // refused" from "nobody was there". Fail-closed is correct; losing the
    // reason is the part that is open.
    expect(denied).toBe(false);
    expect(timedOut).toBe(false);
    expect(timedOut).toBe(denied);
  });

  it("never throws HitlTimeoutError, though the class exists to describe a timeout", async () => {
    // Arrange
    const neverAnswers = vi.fn().mockImplementation(() => new Promise<boolean>(() => {}));
    const mw = new HitlMiddleware({ tools: ["deploy"], approve: neverAnswers, timeoutMs: 50 });

    // Act
    const settled = await mw.shouldProceed("deploy", {}).then(
      (value) => ({ threw: false as const, value }),
      (error: unknown) => ({ threw: true as const, error }),
    );

    // Assert — the declared error type is not on this path. Asserting it here
    // means a future wiring that starts throwing it has to come past this test.
    expect(settled.threw).toBe(false);
    expect(settled).not.toBeInstanceOf(HitlTimeoutError);
    expect(new HitlTimeoutError("deploy", 50).code).toBe("hitl_timeout");
  });

  it("passes tool name and input to approve callback", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const mw = new HitlMiddleware({ tools: ["deploy"], approve });
    const input = { env: "production", version: "1.0" };
    await mw.shouldProceed("deploy", input);
    expect(approve).toHaveBeenCalledWith("deploy", input);
  });

  it("intercepts multiple configured tools", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const mw = new HitlMiddleware({
      tools: ["execute", "writeFile", "deploy"],
      approve,
    });

    await mw.shouldProceed("readFile", {});
    expect(approve).not.toHaveBeenCalled();

    await mw.shouldProceed("execute", {});
    expect(approve).toHaveBeenCalledTimes(1);

    await mw.shouldProceed("writeFile", {});
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("uses default timeout of 5 minutes", () => {
    const mw = new HitlMiddleware({
      tools: ["execute"],
      approve: vi.fn(),
    });
    expect(mw.timeoutMs).toBe(300_000);
  });

  it("returns false when approve throws (EC-4 fail-closed)", async () => {
    const approve = vi.fn().mockRejectedValue(new Error("network error"));
    const mw = new HitlMiddleware({ tools: ["execute"], approve });
    const result = await mw.shouldProceed("execute", { command: "test" });
    expect(result).toBe(false);
  });
});
