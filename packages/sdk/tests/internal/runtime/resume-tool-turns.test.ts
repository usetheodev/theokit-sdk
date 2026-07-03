/**
 * M3 #62 (T4.1) — RED-first: session hydration must NOT silently drop tool turns.
 * A resumed agent keeps its tool history (folded as assistant context), instead of
 * only user/assistant. Legacy user/assistant JSONL still hydrates unchanged.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendPersistedMessages,
  readSessionFile,
} from "../../../src/internal/runtime/session/agent-session-store.js";

describe("M3 #62 — non-lossy session hydration", () => {
  it("includes tool_call/tool_result turns in the hydrated context (was dropped)", async () => {
    const root = mkdtempSync(join(tmpdir(), "resume-tool-"));
    await appendPersistedMessages(root, "a1", [
      { role: "user", text: "run ls", at: 1 },
      { role: "assistant", text: "calling shell", at: 2 },
      { role: "tool_call", text: "shell(ls)", at: 3 },
      { role: "tool_result", text: "file.txt", at: 4 },
    ]);
    const hydrated = await readSessionFile(root, "a1");
    // All 4 turns survive resume (was 2 — the tool turns were dropped).
    expect(hydrated).toHaveLength(4);
    const joined = hydrated.map((m) => m.text).join(" | ");
    expect(joined).toContain("shell(ls)");
    expect(joined).toContain("file.txt");
  });

  it("legacy user/assistant-only JSONL still hydrates unchanged (back-compat)", async () => {
    const root = mkdtempSync(join(tmpdir(), "resume-legacy-"));
    await appendPersistedMessages(root, "a2", [
      { role: "user", text: "hi", at: 1 },
      { role: "assistant", text: "yo", at: 2 },
    ]);
    const hydrated = await readSessionFile(root, "a2");
    expect(hydrated.map((m) => `${m.role}:${m.text}`)).toEqual(["user:hi", "assistant:yo"]);
  });
});
