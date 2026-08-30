/**
 * sdk-memory `session-summary-writer` unit test (iter 61).
 *
 * Validates the iter 61 hybrid copy of
 * `internal/memory/storage/session-summary-writer.ts` from sdk-core.
 * sdk-memory now ships the canonical session summary writer per
 * ADR D20 that the future `session-loader.ts` move will compose with.
 *
 * sdk-core retains its copy for v1.x sessions back-compat.
 * Both copies byte-equivalent at runtime (same EC-9 "only finished
 * status writes" gate, same MAX_TURN_CHARS=2000 truncation, same
 * runId sanitization to [a-zA-Z0-9_-]{1,128}, same frontmatter +
 * ## User + ## Assistant body shape, same redactSecrets pass before
 * persist).
 *
 * Uses temp-dir + real file I/O (no mocks) per the no-stubs canon.
 */

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveMemoryRoot,
  type SessionSummaryInput,
  sessionSummaryPath,
  sessionsDir,
  writeSessionSummary,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function sampleInput(overrides: Partial<SessionSummaryInput> = {}): SessionSummaryInput {
  return {
    memoryRoot: resolveMemoryRoot("/will-be-overridden"),
    runId: "abc-123",
    agentId: "test-agent",
    userText: "hello",
    assistantText: "world",
    status: "finished",
    at: Date.UTC(2026, 0, 1, 12, 0, 0),
    ...overrides,
  };
}

describe("sdk-memory session-summary-writer (iter 61)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-sessions-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("path helpers", () => {
    it("test_sessionsDir_resolves_to_theokit_memory_sessions", () => {
      expect(sessionsDir(resolveMemoryRoot(cwd))).toBe(join(cwd, ".theokit", "memory", "sessions"));
    });

    it("test_sessionSummaryPath_uses_runId_md_filename", () => {
      expect(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123")).toBe(
        join(cwd, ".theokit", "memory", "sessions", "abc-123.md"),
      );
    });

    it("test_sessionSummaryPath_sanitizes_path_traversal_runId", () => {
      // The PROPERTY, not the spelling: a malicious runId cannot escape sessionsDir. This asserted
      // the pre-M0-4 lossy `______etc_passwd` because this package carried its own copy of the
      // helper; the shared one hashes a non-conforming id to a `h-<16hex>` token, which is
      // collision-resistant where the underscore collapse was not. The test pinned the copy's
      // staleness — exactly the drift #430 removed and #463 paid for again.
      const path = sessionSummaryPath(resolveMemoryRoot(cwd), "../../etc/passwd");
      const dir = join(cwd, ".theokit", "memory", "sessions");
      expect(path.startsWith(`${dir}/`)).toBe(true);
      expect(path.slice(dir.length + 1)).toMatch(/^[a-zA-Z0-9_-]+\.md$/);
    });

    it("test_sessionSummaryPath_bounds_a_long_runId_and_stays_deterministic", () => {
      const long = "a".repeat(300);
      const basename = sessionSummaryPath(resolveMemoryRoot(cwd), long).split("/").pop() ?? "";
      // Bounded and stable: the shared helper hashes rather than truncating, so the name no longer
      // carries the first 128 characters. What must hold is that it is short, safe, and the same
      // every time — a filename that varied per call would orphan the summary it names.
      expect(basename.length).toBeLessThanOrEqual(132);
      expect(basename).toMatch(/^[a-zA-Z0-9_-]+\.md$/);
      expect(sessionSummaryPath(resolveMemoryRoot(cwd), long).split("/").pop()).toBe(basename);
    });
  });

  describe("writeSessionSummary EC-9 status gate", () => {
    it("test_writes_when_status_finished", async () => {
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), status: "finished" }),
      );
      const file = sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123");
      await expect(access(file)).resolves.toBeUndefined();
    });

    it("test_skips_when_status_running", async () => {
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), status: "running" }),
      );
      await expect(access(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"))).rejects.toThrow();
    });

    it("test_skips_when_status_error", async () => {
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), status: "error" }),
      );
      await expect(access(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"))).rejects.toThrow();
    });

    it("test_skips_when_status_cancelled", async () => {
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), status: "cancelled" }),
      );
      await expect(access(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"))).rejects.toThrow();
    });
  });

  describe("body content", () => {
    it("test_body_has_frontmatter_user_assistant_sections", async () => {
      await writeSessionSummary(
        sampleInput({
          memoryRoot: resolveMemoryRoot(cwd),
          userText: "the user asked X",
          assistantText: "the assistant said Y",
        }),
      );
      const raw = await readFile(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"), "utf8");
      expect(raw).toContain("---");
      expect(raw).toContain("runId: abc-123");
      expect(raw).toContain("agentId: test-agent");
      expect(raw).toContain("at: 2026-01-01T12:00:00.000Z");
      expect(raw).toContain("status: finished");
      expect(raw).toContain("## User\n\nthe user asked X");
      expect(raw).toContain("## Assistant\n\nthe assistant said Y");
    });

    it("test_truncates_user_text_above_MAX_TURN_CHARS_2000", async () => {
      const longUser = "u".repeat(2500);
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), userText: longUser }),
      );
      const raw = await readFile(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"), "utf8");
      // Should contain 2000 'u' chars + ellipsis, not the original 2500.
      expect(raw).not.toContain("u".repeat(2500));
      expect(raw).toContain(`${"u".repeat(2000)}…`);
    });

    it("test_truncates_assistant_text_above_MAX_TURN_CHARS_2000", async () => {
      const longAssistant = "a".repeat(2500);
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), assistantText: longAssistant }),
      );
      const raw = await readFile(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"), "utf8");
      expect(raw).not.toContain("a".repeat(2500));
      expect(raw).toContain(`${"a".repeat(2000)}…`);
    });

    it("test_redacts_secrets_in_user_text_before_persist", async () => {
      const FAKE_KEY = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      await writeSessionSummary(
        sampleInput({ memoryRoot: resolveMemoryRoot(cwd), userText: `my key is ${FAKE_KEY}` }),
      );
      const raw = await readFile(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"), "utf8");
      expect(raw).not.toContain(FAKE_KEY);
      expect(raw).toContain("my key is");
    });

    it("test_redacts_secrets_in_assistant_text_before_persist", async () => {
      const FAKE_KEY = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
      await writeSessionSummary(
        sampleInput({
          memoryRoot: resolveMemoryRoot(cwd),
          assistantText: `here you go: ${FAKE_KEY}`,
        }),
      );
      const raw = await readFile(sessionSummaryPath(resolveMemoryRoot(cwd), "abc-123"), "utf8");
      expect(raw).not.toContain(FAKE_KEY);
      expect(raw).toContain("here you go:");
    });
  });
});
