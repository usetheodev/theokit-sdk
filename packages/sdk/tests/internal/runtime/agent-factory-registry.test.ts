/**
 * Unit tests for the Agent-facade inversion seam (agent-factory-registry).
 *
 * The seam lets internal subsystems (LocalAgent.runUntil/fork, eval, scorers,
 * cron) invoke the public `Agent` facade without a direct `import { Agent }`
 * that would invert the public-api -> internal dependency direction (enforced
 * by the `internal-must-not-import-facade` dependency-cruiser rule).
 *
 * The registration slot lives on `globalThis` under a `Symbol.for` key (NOT a module-level `let`) so
 * that duplicate copies of this module — `tsup` inlines one per public entry with `splitting: false` —
 * share ONE registration. So `beforeEach` clears the GLOBAL slot (not just modules) to start each test
 * unregistered; `vi.resetModules()` alone would not, since the singleton no longer lives in the module.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentFacadePort } from "../../../src/internal/runtime/registry/agent-factory-registry.js";

const REGISTRY = "../../../src/internal/runtime/registry/agent-factory-registry.js";

/** Same key the registry uses — kept in sync so the test can assert/clear the process-global slot. */
const FACADE_KEY = Symbol.for("theokit.internal.runtime.agentFacade");
function clearGlobalFacade(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[FACADE_KEY];
}

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
    clearGlobalFacade();
    vi.resetModules();
  });
  afterAll(clearGlobalFacade);

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

  it("stores the facade on the process-global Symbol.for slot (cross-bundle singleton)", async () => {
    // Regression: with `tsup splitting: false` + dual esm/cjs, each public entry (`.`, `./a2a`, …)
    // inlines its OWN copy of this module. A module-level `let` would give each copy a private slot —
    // a subagent invoked via `./a2a` would then read a copy the `.` entry never registered ("Agent
    // facade not registered"). Storing on `globalThis[Symbol.for(...)]` makes all copies share ONE slot.
    const mod = await import(REGISTRY);
    const fake = makeFakeFacade();
    expect((globalThis as Record<PropertyKey, unknown>)[FACADE_KEY]).toBeUndefined();
    mod.setAgentFacade(fake);
    // A SEPARATE conceptual "module copy" (any code reading the same global key) sees the same facade.
    expect((globalThis as Record<PropertyKey, unknown>)[FACADE_KEY]).toBe(fake);
  });

  it("survives vi.resetModules — a re-imported copy reads the SAME registration", async () => {
    // Proves the singleton is not tied to a module instance: register via one import, read via a fresh
    // re-imported instance (what a second bundled copy effectively is) and get the same facade.
    const first = await import(REGISTRY);
    const fake = makeFakeFacade();
    first.setAgentFacade(fake);
    vi.resetModules();
    const second = await import(REGISTRY);
    expect(second.getAgentFacade()).toBe(fake);
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
