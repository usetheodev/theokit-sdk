/**
 * sdk-memory `recordSessionSummary` secret-redaction test (iter 42).
 *
 * Verifies that API keys typed by the user (or echoed by the assistant)
 * are redacted before they hit the disk artefact. Uses sdk-core's
 * public `Security.redact` API (ADR D68 — 12 built-in patterns).
 *
 * Without this regression test, a future refactor of `renderSession
 * SummaryMarkdown` could silently drop the Security.redact() call +
 * leak credentials into `.theokit/memory/sessions/*.md` files.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryMarkdownProvider, resolveMemoryRoot } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("recordSessionSummary secret redaction (iter 42)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-redact-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_openai_api_key_redacted_in_user_text", async () => {
    const provider = createInMemoryMarkdownProvider();
    await provider.init({ cwd });
    if (provider.recordSessionSummary === undefined) throw new Error("missing");

    // Realistic-shape but bogus key matching OpenAI's `sk-` pattern.
    const FAKE_KEY = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "redact-test-1",
      agentId: "agent-redact",
      userText: `set OPENAI_API_KEY=${FAKE_KEY} and continue`,
      assistantText: "key updated",
      status: "finished",
      at: Date.now(),
    });

    const filePath = join(cwd, ".theokit", "memory", "sessions", "redact-test-1.md");
    const content = await readFile(filePath, "utf-8");
    // The raw key must NOT survive verbatim
    expect(content).not.toContain(FAKE_KEY);
    // The "## User" section must still have the user's framing text
    expect(content).toContain("set OPENAI_API_KEY=");
  });

  it("test_redaction_applies_to_both_user_and_assistant_sections", async () => {
    const provider = createInMemoryMarkdownProvider();
    await provider.init({ cwd });
    if (provider.recordSessionSummary === undefined) throw new Error("missing");

    const FAKE_USER_KEY = "sk-proj-USERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const FAKE_ASSISTANT_KEY = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "redact-test-2",
      agentId: "agent-redact",
      userText: `here's my key: ${FAKE_USER_KEY}`,
      assistantText: `i echo it back: ${FAKE_ASSISTANT_KEY}`,
      status: "finished",
      at: Date.now(),
    });

    const filePath = join(cwd, ".theokit", "memory", "sessions", "redact-test-2.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).not.toContain(FAKE_USER_KEY);
    expect(content).not.toContain(FAKE_ASSISTANT_KEY);
  });

  it("test_non_secret_text_passes_through_unchanged", async () => {
    const provider = createInMemoryMarkdownProvider();
    await provider.init({ cwd });
    if (provider.recordSessionSummary === undefined) throw new Error("missing");

    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "no-secrets",
      agentId: "agent-redact",
      userText: "what is the capital of France?",
      assistantText: "Paris",
      status: "finished",
      at: Date.now(),
    });

    const filePath = join(cwd, ".theokit", "memory", "sessions", "no-secrets.md");
    const content = await readFile(filePath, "utf-8");
    // The original text shows up verbatim.
    expect(content).toContain("what is the capital of France?");
    expect(content).toContain("Paris");
  });
});
