/**
 * T2.1 — agent-resolver tests (D351).
 */

import type { SDKAgent } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";
import { InvalidAgentError, resolveAgentFactory } from "../src/agent-resolver.js";

const makeFakeAgent = (): SDKAgent =>
  ({
    agentId: "a-1",
    model: undefined,
    send: vi.fn(),
    close: vi.fn(),
    reload: vi.fn(),
    dispose: vi.fn(),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(),
  }) as unknown as SDKAgent;

describe("resolveAgentFactory", () => {
  it("resolver_function_factory_calls_once_per_session", async () => {
    const factoryFn = vi.fn(async (_id: string) => makeFakeAgent());
    const factory = resolveAgentFactory(factoryFn);
    await factory("s-1");
    await factory("s-2");
    expect(factoryFn).toHaveBeenCalledTimes(2);
    expect(factoryFn).toHaveBeenNthCalledWith(1, "s-1");
    expect(factoryFn).toHaveBeenNthCalledWith(2, "s-2");
  });

  it("resolver_single_instance_wraps_in_memoized_factory_and_warns", async () => {
    const agent = makeFakeAgent();
    const log = vi.fn();
    const factory = resolveAgentFactory(agent, { log });
    const a = await factory("s-1");
    const b = await factory("s-2");
    expect(a).toBe(agent);
    expect(b).toBe(agent);
    // warn once
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/serveAcp received a single SDKAgent/);
  });

  it("resolver_invalid_input_throws_configuration_error", () => {
    expect(() => resolveAgentFactory({} as unknown as SDKAgent)).toThrow(InvalidAgentError);
  });

  it("resolver_factory_throw_propagates", async () => {
    const factory = resolveAgentFactory(async () => {
      throw new Error("nope");
    });
    await expect(factory("s-1")).rejects.toThrow(/nope/);
  });
});
