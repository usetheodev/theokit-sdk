/**
 * Tests for transcript JSONL append redaction (T1.3, ADR D68).
 *
 * Each appended record may contain user-provided text or tool result
 * output. Sensitive tokens must be redacted before they land on disk.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendToSessionFile,
  sessionFilePath,
} from "../../../src/internal/runtime/agent-session-store.js";

describe("appendToSessionFile T1.3 — secret redaction", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "theokit-session-redact-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("masks sk-* tokens in user text before persisting", async () => {
    await appendToSessionFile(cwd, "agent-test", {
      role: "user",
      text: "rotate this for me: sk-abcdef0123456789ghijklmn",
    });
    const raw = readFileSync(sessionFilePath(cwd, "agent-test"), "utf8");
    expect(raw).not.toContain("sk-abcdef0123456789ghijklmn");
    expect(raw.endsWith("\n")).toBe(true);
    // Line is still valid JSON after redaction (no quote-breaking happened)
    for (const line of raw.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("masks Authorization: Bearer in tool output text", async () => {
    await appendToSessionFile(cwd, "agent-test", {
      role: "assistant",
      text: "Tool output: curl -H 'Authorization: Bearer eyJabc.def.ghi.test' worked.",
    });
    const raw = readFileSync(sessionFilePath(cwd, "agent-test"), "utf8");
    expect(raw).not.toContain("eyJabc.def.ghi.test");
    expect(raw).toContain("Bearer ***");
  });

  it("does not corrupt JSON validity post-redact", async () => {
    await appendToSessionFile(cwd, "agent-test", {
      role: "user",
      text: 'multi\nline\ttext with "quotes" and sk-abcdef0123456789ghijklmn',
    });
    const raw = readFileSync(sessionFilePath(cwd, "agent-test"), "utf8");
    for (const line of raw.split("\n").filter(Boolean)) {
      const parsed = JSON.parse(line) as { role: string; text: string };
      expect(parsed.role).toBe("user");
      expect(parsed.text).not.toContain("sk-abcdef0123456789ghijklmn");
    }
  });
});
