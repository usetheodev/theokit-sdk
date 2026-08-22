/**
 * SE40 (v4.0) — session hydration must NOT silently drop tool turns. A resumed
 * agent keeps its tool history (folded as assistant context) because the native
 * transcript reconstruction (`readSessionMessages`) folds tool_use / tool_result
 * blocks into assistant-role context. Plain user/assistant turns hydrate unchanged.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { FsSessionStore } from "../../../src/internal/persistence/fs-session-store.js";
import {
  persistTurn,
  readSessionMessages,
  type TranscriptLocation,
} from "../../../src/internal/session/agent-session-store.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

const cwd = "/tmp/resume-proj";
function loc(agentId: string): TranscriptLocation {
  return { cwd, agentId, model: "test" };
}

describe("SE40 — non-lossy session hydration", () => {
  it("includes tool_call/tool_result turns in the hydrated context (folded to assistant)", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "resume-tool-"));
    const __baseDirCleanup1 = baseDir;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseDirCleanup1);
    });
    const store = new FsSessionStore({ baseDir, cwd });
    await persistTurn(store, loc("a1"), "a1", {
      userText: "run ls",
      conversation: [
        {
          type: "agentConversationTurn",
          turn: {
            steps: [
              { type: "assistantMessage", message: { text: "calling shell" } },
              { type: "toolCall", message: { callId: "c1", name: "shell", args: { cmd: "ls" } } },
              {
                type: "toolResult",
                message: { callId: "c1", name: "shell", result: "file.txt", isError: false },
              },
            ],
          },
        },
      ],
    });
    const hydrated = await readSessionMessages(store, "a1");
    const joined = hydrated.map((m) => m.text).join(" | ");
    expect(joined).toContain("shell");
    expect(joined).toContain("file.txt");
  });

  it("plain user/assistant turns hydrate unchanged", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "resume-legacy-"));
    const __baseDirCleanup2 = baseDir;
    onTestFinished(() => {
      removeTempDirRobustSync(__baseDirCleanup2);
    });
    const store = new FsSessionStore({ baseDir, cwd });
    await persistTurn(store, loc("a2"), "a2", {
      userText: "hi",
      conversation: [
        {
          type: "agentConversationTurn",
          turn: { steps: [{ type: "assistantMessage", message: { text: "yo" } }] },
        },
      ],
    });
    const hydrated = await readSessionMessages(store, "a2");
    expect(hydrated.map((m) => `${m.role}:${m.text}`)).toEqual(["user:hi", "assistant:yo"]);
  });
});
