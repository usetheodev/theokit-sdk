/**
 * Agent-scope recall test (SDK 2.0 Phase 1 / iter 36).
 *
 * Validates the multi-agent privacy invariant: a session summary
 * written by agent-A is NOT recalled in agent-B's `runActivePass`.
 *
 * The filter is gated on YAML frontmatter `agentId:` parsing — when
 * the field doesn't match `args.agentId`, the summary is skipped.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryMarkdownProvider, resolveMemoryRoot } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("agent-scope recall (iter 36)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-scope-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_recall_skips_summaries_from_different_agentId", async () => {
    // Agent-A writes a summary mentioning "secret-keyword".
    const a = createInMemoryMarkdownProvider();
    const handleA = await a.init({ cwd });
    if (a.recordSessionSummary === undefined) throw new Error("missing");
    await a.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "agent-a-run",
      agentId: "agent-A",
      userText: "secret-keyword from agent-A",
      assistantText: "noted",
      status: "finished",
      at: Date.now(),
    });
    a.dispose(handleA);

    // Agent-B does an active pass with the same keyword.
    const b = createInMemoryMarkdownProvider();
    const handleB = await b.init({ cwd });
    const passB = await b.runActivePass(handleB, {
      userMessage: "secret-keyword",
      history: [],
      agentId: "agent-B",
    });
    // Should NOT see agent-A's summary.
    expect(passB.facts.length).toBe(0);
    expect(passB.systemPromptAdditions).toBeUndefined();
  });

  it("test_recall_includes_summaries_from_same_agentId", async () => {
    // Agent-X writes a summary.
    const writer = createInMemoryMarkdownProvider();
    const hw = await writer.init({ cwd });
    if (writer.recordSessionSummary === undefined) throw new Error("missing");
    await writer.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "agent-x-run-1",
      agentId: "agent-X",
      userText: "shared-keyword for agent-X",
      assistantText: "ok",
      status: "finished",
      at: Date.now(),
    });
    writer.dispose(hw);

    // Agent-X reads its own summary in a future session.
    const reader = createInMemoryMarkdownProvider();
    const hr = await reader.init({ cwd });
    const pass = await reader.runActivePass(hr, {
      userMessage: "shared-keyword",
      history: [],
      agentId: "agent-X",
    });
    // Same agentId → recall fires.
    expect(pass.facts.length).toBeGreaterThan(0);
    expect(pass.systemPromptAdditions).toContain("shared-keyword");
  });

  it("test_recall_only_sees_own_agent_summaries_when_mixed_corpus", async () => {
    // Setup: 3 summaries, 2 from agent-A + 1 from agent-B, all with
    // the same content keyword.
    const setup = createInMemoryMarkdownProvider();
    const hs = await setup.init({ cwd });
    if (setup.recordSessionSummary === undefined) throw new Error("missing");
    for (const { agentId, runId } of [
      { agentId: "agent-A", runId: "a-1" },
      { agentId: "agent-A", runId: "a-2" },
      { agentId: "agent-B", runId: "b-1" },
    ]) {
      await setup.recordSessionSummary({
        cwd,
        memoryRoot: resolveMemoryRoot(cwd),
        runId,
        agentId,
        userText: "common-keyword across agents",
        assistantText: "ok",
        status: "finished",
        at: Date.now(),
      });
    }
    setup.dispose(hs);

    // Agent-A reads — should see 2 hits (their own runs).
    const readerA = createInMemoryMarkdownProvider();
    const ha = await readerA.init({ cwd });
    const passA = await readerA.runActivePass(ha, {
      userMessage: "common-keyword",
      history: [],
      agentId: "agent-A",
    });
    expect(passA.facts.length).toBe(2);

    // Agent-B reads — should see 1 hit (their own run only).
    const readerB = createInMemoryMarkdownProvider();
    const hb = await readerB.init({ cwd });
    const passB = await readerB.runActivePass(hb, {
      userMessage: "common-keyword",
      history: [],
      agentId: "agent-B",
    });
    expect(passB.facts.length).toBe(1);
  });

  it("test_malformed_frontmatter_summary_is_skipped_when_agentId_filter_active", async () => {
    // Manually write a markdown file with NO agentId frontmatter.
    const { mkdir, writeFile } = await import("node:fs/promises");
    const sessionsDir = join(cwd, ".theokit", "memory", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, "malformed.md"),
      "---\nrunId: malformed\n---\n## User\ncommon-keyword content\n",
    );

    // Agent-A reads — malformed file has no agentId match, gets skipped.
    const reader = createInMemoryMarkdownProvider();
    const h = await reader.init({ cwd });
    const pass = await reader.runActivePass(h, {
      userMessage: "common-keyword",
      history: [],
      agentId: "agent-A",
    });
    expect(pass.facts.length).toBe(0);
  });
});
