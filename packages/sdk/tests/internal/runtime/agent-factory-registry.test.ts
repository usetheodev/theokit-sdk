/**
 * Unit tests for the Agent-facade inversion seam (agent-factory-registry).
 *
 * The seam lets internal subsystems (LocalAgent.runUntil/fork, eval, scorers,
 * cron) invoke the public `Agent` facade without a direct `import { Agent }`
 * that would invert the public-api -> internal dependency direction (enforced
 * by the `internal-must-not-import-facade` dependency-cruiser rule).
 *
 * `vi.resetModules()` gives each test a fresh module instance so the
 * module-level singleton starts unregistered.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentFacadePort } from "../../../src/internal/runtime/registry/agent-factory-registry.js";

const REGISTRY = "../../../src/internal/runtime/registry/agent-factory-registry.js";

function makeFakeFacade(): AgentFacadePort {
  return {
    create: vi.fn(),
    prompt: vi.fn(),
    get: vi.fn(),
    resume: vi.fn(),
    batch: vi.fn(),
  } as unknown as AgentFacadePort;
}

describe("agent-factory-registry seam", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getAgentFacade throws a clear error before registration", async () => {
    const mod = await import(REGISTRY);
    expect(() => mod.getAgentFacade()).toThrow(/Agent facade not registered/);
  });

  it("round-trips the registered facade by reference", async () => {
    const mod = await import(REGISTRY);
    const fake = makeFakeFacade();
    mod.setAgentFacade(fake);
    expect(mod.getAgentFacade()).toBe(fake);
  });

  it("is idempotent — re-registration replaces the previous facade", async () => {
    const mod = await import(REGISTRY);
    const first = makeFakeFacade();
    const second = makeFakeFacade();
    mod.setAgentFacade(first);
    mod.setAgentFacade(second);
    expect(mod.getAgentFacade()).toBe(second);
  });

  it("exposes every facade method the internal callers consume", async () => {
    const mod = await import(REGISTRY);
    const fake = makeFakeFacade();
    mod.setAgentFacade(fake);
    const facade = mod.getAgentFacade();
    // create (local-agent/cron), prompt (scorers), get/resume (cron), batch (eval)
    for (const method of ["create", "prompt", "get", "resume", "batch"] as const) {
      expect(typeof facade[method]).toBe("function");
    }
  });
});
