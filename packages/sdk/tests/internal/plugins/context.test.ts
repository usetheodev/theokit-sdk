/**
 * Tests for PluginContext + seal (T1.2, ADR D99).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPluginContext } from "../../../src/internal/plugins/context.js";

const stderrSpy = vi.spyOn(process.stderr, "write");

beforeEach(() => {
  stderrSpy.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PluginContext (T1.2)", () => {
  it("registerTool collects into registrations", () => {
    const { ctx, registrations } = createPluginContext();
    ctx.registerTool({
      name: "t",
      description: "d",
      // biome-ignore lint/suspicious/noExplicitAny: test-only shape
      inputSchema: {} as any,
      handler: () => "ok",
    });
    expect(registrations.tools).toHaveLength(1);
    expect(registrations.tools[0]?.name).toBe("t");
  });

  it("registerCommand collects with optional description", () => {
    const { ctx, registrations } = createPluginContext();
    ctx.registerCommand("cmd", () => "ok", { description: "Does the thing" });
    expect(registrations.commands).toHaveLength(1);
    expect(registrations.commands[0]?.description).toBe("Does the thing");
  });

  it("on() collects multiple handlers per hook", () => {
    const { ctx, registrations } = createPluginContext();
    ctx.on("pre_tool_call", () => undefined);
    ctx.on("pre_tool_call", () => undefined);
    expect(registrations.hooks.get("pre_tool_call")).toHaveLength(2);
  });

  it("injectMessage defaults role to user", () => {
    const { ctx, registrations } = createPluginContext();
    ctx.injectMessage("hello");
    expect(registrations.injected[0]?.role).toBe("user");
  });

  it("EC-2: ignores non-function handler with stderr warn", () => {
    const { ctx, registrations } = createPluginContext();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate type bypass to simulate bad plugin
    ctx.on("pre_tool_call", null as any);
    expect(registrations.hooks.get("pre_tool_call")).toBeUndefined();
    expect(stderrSpy).toHaveBeenCalled();
    const msg = (stderrSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(msg).toContain("non-function handler");
  });

  it("sealed in dev: throws on direct set", () => {
    const { ctx } = createPluginContext();
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing seal
      (ctx as any).someInternal = "boom";
    }).toThrow(/sealed/);
  });

  it("unsealed in production (zero overhead)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { ctx } = createPluginContext();
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing prod unsealed
      (ctx as any).someInternal = "x";
    }).not.toThrow();
  });

  it("each createPluginContext returns isolated registrations", () => {
    const a = createPluginContext();
    const b = createPluginContext();
    a.ctx.registerTool({
      name: "ta",
      description: "",
      // biome-ignore lint/suspicious/noExplicitAny: test-only
      inputSchema: {} as any,
      handler: () => "",
    });
    expect(a.registrations.tools).toHaveLength(1);
    expect(b.registrations.tools).toHaveLength(0);
  });
});
