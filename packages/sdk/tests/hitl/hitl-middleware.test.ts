import { describe, expect, it, vi } from "vitest";

import { HitlMiddleware } from "../../src/internal/runtime/tools/hitl-middleware.js";

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
