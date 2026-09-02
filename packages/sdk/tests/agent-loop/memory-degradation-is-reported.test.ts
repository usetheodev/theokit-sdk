/**
 * A MemoryProvider that fails does not silently disappear from the run.
 *
 * `initLoopContext` had three bare `catch { <field> = <empty> }` blocks: an init failure meant no
 * memory tool was registered, a `buildTools` failure meant no provider tools, and a `runActivePass`
 * failure meant no recalled context in the system prompt. The agent then answered without the memory
 * it was configured with, and nothing recorded it — not stderr, not the typed `RunEventSink`, not the
 * span in scope. A host UI showed a healthy run.
 *
 * The BEHAVIOUR is unchanged and deliberately so: degrading to a working agent is right. What these
 * assert is that the degradation is now observable, which is the whole of the defect.
 *
 * `safeListTools` in the same file already did this for MCP, which is what made the three a defect
 * rather than a style preference — the correct pattern was a hundred lines below them.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MemoryProvider, RunEvent } from "@theokit/sdk";
import { afterAll, describe, expect, it } from "vitest";

import { driveLoop } from "../helpers/agent-loop-driver.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

const CWD = mkdtempSync(join(tmpdir(), "theokit-memdegrade-"));
afterAll(() => {
  removeTempDirRobustSync(CWD);
});

/** A provider whose `init` rejects — the first of the three stages. */
const failingProvider = {
  init: () => Promise.reject(new Error("index is locked by another process")),
  buildTools: () => [],
  runActivePass: () => Promise.resolve(undefined),
  recordSessionSummary: () => Promise.resolve(undefined),
} as unknown as MemoryProvider;

describe("memory degradation is reported", () => {
  it("emits memory_degraded naming the stage and the cause, and the run still completes", async () => {
    const events: RunEvent[] = [];
    const { result } = await driveLoop(CWD, {
      memoryProvider: failingProvider,
      runEventSink: (event: RunEvent) => events.push(event),
    } as never);

    const degraded = events.filter((e) => e.type === "memory_degraded");
    expect(degraded, "the failure has to reach the consumer, not only stderr").toHaveLength(1);
    expect((degraded[0] as { stage: string }).stage).toBe("init");
    expect(
      (degraded[0] as { message: string }).message,
      "the provider's own words, so an operator can act on them",
    ).toContain("index is locked");

    // The other half of the contract: this is a DEGRADATION, not a failure. The run finished.
    expect(result).toBeDefined();
  });
});
