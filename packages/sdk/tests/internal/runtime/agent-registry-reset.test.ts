/**
 * B-117 — regression cover for the autouse reset wired into `vitest.setup.ts`.
 *
 * `agents` in `src/internal/runtime/registry/agent-registry.ts` is a process-wide
 * `Map`, module-level state that lives for as long as the worker process does.
 * `THEOKIT_HOME` isolation (also autouse, in the same setup file) resets everything
 * that touches disk, but never touched this in-memory Map — a probe measured a
 * registry growing 5 → 8 agents across tests in one file before the reset existed.
 *
 * This is deliberately two SEPARATE tests, not one: the reset runs in
 * `vitest.setup.ts`'s autouse `beforeEach`, which fires BEFORE every test — the
 * only way to observe "did the PREVIOUS test's registration survive" is to
 * register in one test and assert in the NEXT one. A single test that registers
 * then immediately asserts would pass whether or not any reset ever ran.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  listRegisteredAgents,
  registerAgent,
} from "../../../src/internal/runtime/registry/agent-registry.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

function registerFakeAgent(agentId: string): void {
  // An isolated, never-read cwd: registerAgent schedules a background disk save, and
  // this test only cares about the in-memory Map — the tmpdir keeps that fire-and-forget
  // write off the real project tree, and removeTempDirRobustSync cleans it up.
  const dir = mkdtempSync(join(tmpdir(), "theokit-registry-reset-"));
  onTestFinished(() => {
    removeTempDirRobustSync(dir);
  });
  registerAgent({
    agentId,
    runtime: "local",
    createdAt: Date.now(),
    lastModified: Date.now(),
    archived: false,
    options: {},
    cwd: dir,
  });
}

describe("agent registry reset (B-117)", () => {
  it("test_registers_one_agent_for_the_next_test_to_observe", () => {
    registerFakeAgent("b117-reset-probe");
    expect(listRegisteredAgents()).toHaveLength(1);
  });

  it("test_the_registry_starts_empty_in_each_test", () => {
    // If vitest.setup.ts's autouse `clearAgentRegistry()` were removed, the agent
    // registered by the PREVIOUS test would still be here and this assertion
    // would fail with length 1 (or more, under repeated re-runs).
    expect(listRegisteredAgents()).toHaveLength(0);
  });
});
