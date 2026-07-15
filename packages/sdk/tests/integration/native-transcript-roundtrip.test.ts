/**
 * SE40 — acceptance gate (T6): the NATIVE session transcript our writer emits PARSES through the REAL
 * `claude-code-log` Pydantic parser, with zero dangling tool_use. This is the "parses through a real
 * ecosystem parser" evidence, re-homed onto the native format — it replaces the SE39
 * ClaudeCodeTranscriptWriter round-trip that was deleted with that writer. Gated on the cloned parser +
 * python3 + pydantic, so it skips cleanly where the (gitignored) study clone is absent, e.g. CI.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  SessionTranscript,
  transcriptPath,
  writeTranscript,
} from "../../src/internal/persistence/session-transcript.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..");
const CLONE = join(REPO, ".claude", "knowledge-base", "references", "claude-code-log");
const VALIDATOR = join(__dirname, "_helpers", "validate_claude_code_jsonl.py");

function pythonReady(): boolean {
  if (!existsSync(join(CLONE, "claude_code_log", "models.py"))) return false;
  try {
    execFileSync("python3", ["-c", "import pydantic"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const ready = pythonReady();
let work: string | undefined;
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe.skipIf(!ready)(
  "SE40 — native transcript parses through the real claude-code-log parser",
  () => {
    it("a two-tool-call native transcript parses with zero dangling tool_use", async () => {
      const t = new SessionTranscript({
        cwd: "/home/u/proj",
        sessionId: "se40-rt",
        model: "openai/gpt-4o-mini",
      });
      t.appendUserTurn("Compute 17*23 then +5 using the calculator.");
      t.appendAssistantTurn({
        text: "Computing.",
        toolCalls: [{ id: "toolu_1", name: "calculator", input: { a: 17, b: 23, op: "mul" } }],
      });
      t.appendToolResults([{ toolUseId: "toolu_1", content: "391", isError: false }]);
      t.appendAssistantTurn({
        text: "Now adding 5.",
        toolCalls: [{ id: "toolu_2", name: "calculator", input: { a: 391, b: 5, op: "add" } }],
      });
      t.appendToolResults([{ toolUseId: "toolu_2", content: "396", isError: false }]);
      t.appendAssistantTurn({ text: "The answer is 396." });

      work = mkdtempSync(join(tmpdir(), "se40-rt-"));
      const jsonl = transcriptPath(work, "/home/u/proj", "se40-rt");
      await writeTranscript(jsonl, t.records());

      // the REAL parser accepts every record AND both tool_use blocks pair with a tool_result
      const out = execFileSync("python3", [VALIDATOR, CLONE, jsonl], { encoding: "utf8" }).trim();
      expect(out).toMatch(/^OK \d+ records, 2 tool pairs$/);
    });
  },
);
