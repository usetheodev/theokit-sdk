/**
 * T1.2 — pin the public-shape of `RegisteredAgent` so accidental drift in
 * `internal/runtime/registry/agent-registry-contract.ts` is caught by tsc
 * before it ships. The leaf file itself was extracted under the prior plan
 * `arch-review-fixes-2026-06-06` (T3.1 / ADR D431) — this iter adds the
 * missing snapshot test the T1.2 plan acceptance asks for.
 *
 * This file RUNS in the default gate. The blanket `tests/contract/**` exclusion it used to cite was
 * replaced by `ROADMAP_ONLY_SUITES`, a named list of three files that does not include this one —
 * `vitest.config.ts` records the measurement. The claim also attributed the exclusion to
 * `cycle-implement.md`, which never said it.
 *
 * The part that IS load-bearing: the compile-time pins below are checked by `tsc`, not by the
 * runtime assertions, so a `pnpm test` that skipped the typecheck would not exercise them.
 */

import { describe, expect, it } from "vitest";

import type {
  AgentRuntime,
  RegisteredAgent,
} from "../../src/internal/runtime/registry/agent-registry-contract.js";

describe("T1.2 — RegisteredAgent contract shape (snapshot)", () => {
  it("AgentRuntime is the closed union 'local' | 'cloud'", () => {
    const runtimes: AgentRuntime[] = ["local", "cloud"];
    expect(runtimes).toHaveLength(2);
    // Compile-time pin: adding a third literal would require updating callers
    // (registry routing, list filters, store serializer).
    type ExhaustiveCheck = AgentRuntime extends "local" | "cloud" ? true : false;
    const _typecheck: ExhaustiveCheck = true;
    expect(_typecheck).toBe(true);
  });

  it("RegisteredAgent has every required field at the canonical type", () => {
    // Snapshot via a satisfies assertion — any drop, rename, or type change
    // of a required field surfaces at tsc time as a TS2353/TS2741 diagnostic.
    const sample: RegisteredAgent = {
      agentId: "agent-test-0001",
      runtime: "local",
      createdAt: 1_700_000_000_000,
      lastModified: 1_700_000_000_000,
      archived: false,
      options: { model: { id: "openai/gpt-4o-mini" } },
    };
    expect(sample.agentId).toBe("agent-test-0001");
    expect(sample.runtime).toBe("local");
    expect(sample.archived).toBe(false);
  });

  it("RegisteredAgent optional fields are accepted", () => {
    const cloudSample: RegisteredAgent = {
      agentId: "agent-test-0002",
      runtime: "cloud",
      createdAt: 1_700_000_000_000,
      lastModified: 1_700_000_000_000,
      archived: false,
      options: { model: { id: "anthropic/claude-3-5-haiku-latest" } },
      name: "Pinned Cloud",
      summary: "Pin test",
      model: { id: "anthropic/claude-3-5-haiku-latest" },
      repos: ["https://github.com/example/repo"],
      status: "running",
    };
    expect(cloudSample.repos?.[0]).toContain("github.com");
    expect(cloudSample.status).toBe("running");
  });

  it("RegisteredAgent.status is the closed union 'running' | 'finished' | 'error'", () => {
    type StatusUnion = NonNullable<RegisteredAgent["status"]>;
    const statuses: StatusUnion[] = ["running", "finished", "error"];
    expect(statuses).toHaveLength(3);
    type ExhaustiveCheck = StatusUnion extends "running" | "finished" | "error" ? true : false;
    const _typecheck: ExhaustiveCheck = true;
    expect(_typecheck).toBe(true);
  });
});
