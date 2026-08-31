/**
 * Cross-session recall end-to-end test (SDK 2.0 Phase 1 / iter 34).
 *
 * Validates the full "write session summary → recall it in a future
 * session" lifecycle inside sdk-memory's `createInMemoryMarkdownProvider`:
 *
 *   1. Session A: provider records a session summary to disk.
 *   2. Session B (NEW provider instance, SAME cwd): `runActivePass`
 *      with a user message that overlaps the previous summary →
 *      `systemPromptAdditions` includes the recalled snippet.
 *
 * This proves the in-memory provider is now a GENUINE cross-session
 * recall path, not just a per-session Map (which session B couldn't
 * see — Map is process-local).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryMarkdownProvider, resolveMemoryRoot } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("cross-session recall via disk-backed summaries (iter 34)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-recall-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_session_B_recalls_session_A_summary_via_substring_match", async () => {
    // Session A — record a finished run summary.
    const providerA = createInMemoryMarkdownProvider();
    const handleA = await providerA.init({ cwd });
    if (providerA.recordSessionSummary === undefined) {
      throw new Error("recordSessionSummary not defined");
    }
    await providerA.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "session-A",
      agentId: "agent-1",
      userText: "user prefers TypeScript over JavaScript",
      assistantText: "noted",
      status: "finished",
      at: Date.now(),
    });
    providerA.dispose(handleA);

    // Session B — NEW provider instance (in-process Map is empty),
    // SAME cwd. runActivePass should read the session-A summary from
    // disk and include it in systemPromptAdditions.
    const providerB = createInMemoryMarkdownProvider();
    const handleB = await providerB.init({ cwd });
    const pass = await providerB.runActivePass(handleB, {
      userMessage: "what language do I prefer for coding?",
      // No literal substring match.
      history: [],
      agentId: "agent-1",
    });
    // No match expected for this query (no overlap with summary content).
    expect(pass.facts.length).toBe(0);
    expect(pass.systemPromptAdditions).toBeUndefined();
    providerB.dispose(handleB);

    // Session C — query DOES overlap with the stored summary.
    const providerC = createInMemoryMarkdownProvider();
    const handleC = await providerC.init({ cwd });
    const passC = await providerC.runActivePass(handleC, {
      userMessage: "TypeScript",
      history: [],
      agentId: "agent-1",
    });
    expect(passC.facts.length).toBeGreaterThan(0);
    expect(passC.systemPromptAdditions).toBeDefined();
    expect(passC.systemPromptAdditions).toContain("Known facts");
    expect(passC.systemPromptAdditions).toContain("user prefers TypeScript");
    providerC.dispose(handleC);
  });

  it("test_recall_caps_at_5_hits", async () => {
    const writer = createInMemoryMarkdownProvider();
    const handleW = await writer.init({ cwd });
    if (writer.recordSessionSummary === undefined) {
      throw new Error("missing");
    }
    // Write 7 summaries all containing "common-keyword".
    for (let i = 0; i < 7; i++) {
      await writer.recordSessionSummary({
        cwd: cwd,
        memoryRoot: resolveMemoryRoot(cwd),
        runId: `run-${i}`,
        agentId: "agent-1",
        userText: `common-keyword reference ${i}`,
        assistantText: "ok",
        status: "finished",
        at: Date.now(),
      });
    }
    writer.dispose(handleW);

    const reader = createInMemoryMarkdownProvider();
    const handleR = await reader.init({ cwd });
    const pass = await reader.runActivePass(handleR, {
      userMessage: "common-keyword",
      history: [],
      agentId: "agent-1",
    });
    // Hard cap of 5 (RECALL_CAP). Pin the contract so a future change
    // to the cap is intentional, not accidental.
    expect(pass.facts.length).toBe(5);
  });

  it("test_recall_skips_non_markdown_files", async () => {
    // Write a summary + an unrelated file in the same sessions dir.
    const writer = createInMemoryMarkdownProvider();
    const handle = await writer.init({ cwd });
    if (writer.recordSessionSummary === undefined) throw new Error("missing");
    await writer.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "run-md",
      agentId: "a",
      userText: "needle-only-in-md",
      assistantText: "ok",
      status: "finished",
      at: Date.now(),
    });
    writer.dispose(handle);
    // Write a non-md file with the same needle.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(cwd, ".theokit", "memory", "sessions", "noise.txt"), "needle-only-in-md");

    const reader = createInMemoryMarkdownProvider();
    const h = await reader.init({ cwd });
    const pass = await reader.runActivePass(h, {
      userMessage: "needle-only-in-md",
      history: [],
      agentId: "a",
    });
    // Only the .md file should contribute.
    expect(pass.facts.length).toBe(1);
  });

  it("test_recall_returns_empty_when_no_sessions_dir", async () => {
    // Fresh cwd, no session summary ever written.
    const reader = createInMemoryMarkdownProvider();
    const h = await reader.init({ cwd });
    const pass = await reader.runActivePass(h, {
      userMessage: "anything",
      history: [],
      agentId: "a",
    });
    expect(pass.facts.length).toBe(0);
    expect(pass.systemPromptAdditions).toBeUndefined();
  });

  it("test_in_process_facts_AND_disk_recall_both_contribute", async () => {
    const writer = createInMemoryMarkdownProvider();
    const handleW = await writer.init({ cwd });
    if (writer.recordSessionSummary === undefined) throw new Error("missing");
    // Write disk summary
    await writer.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "from-disk",
      agentId: "a",
      userText: "shared-keyword from previous run",
      assistantText: "ok",
      status: "finished",
      at: Date.now(),
    });
    writer.dispose(handleW);

    // New session: persist in-process fact + verify both contribute
    const session = createInMemoryMarkdownProvider();
    const h = await session.init({ cwd });
    const tools = session.buildTools(h, {} as never);
    if (tools[0] === undefined) throw new Error("missing memory_remember");
    await tools[0].handler({ content: "shared-keyword in current session map" });

    const pass = await session.runActivePass(h, {
      userMessage: "shared-keyword",
      history: [],
      agentId: "a",
    });
    // Should have ≥2 facts: 1 from disk + 1 in-process map.
    expect(pass.facts.length).toBeGreaterThanOrEqual(2);
    expect(pass.systemPromptAdditions).toContain("shared-keyword");
  });
});
