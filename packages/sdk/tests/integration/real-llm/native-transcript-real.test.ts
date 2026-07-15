/**
 * SE40 — end-to-end real-LLM acceptance (T6): run a REAL agent with a tool, let the native session
 * persistence write the transcript, then prove `--continue` — a resumed agent hydrates the prior turns
 * from disk and the model recalls a codeword across a simulated restart. When the cloned `claude-code-log`
 * parser is present, the on-disk transcript is ALSO validated through the real Pydantic parser (format
 * compatibility). This replaces the deleted SE39 `ClaudeCodeTranscriptWriter` real-LLM test and satisfies
 * `.claude/rules/real-llm-validation.md` for the native format. Gated on OPENROUTER_API_KEY.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, Tool } from "../../../src/index.js";
import {
  readTranscript,
  reconstructMessages,
  transcriptPath,
} from "../../../src/internal/persistence/session-transcript.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..", "..");
const CLONE = join(REPO, ".claude", "knowledge-base", "references", "claude-code-log");
const VALIDATOR = join(__dirname, "..", "_helpers", "validate_claude_code_jsonl.py");

function pythonReady(): boolean {
  if (!existsSync(join(CLONE, "claude_code_log", "models.py"))) return false;
  try {
    execFileSync("python3", ["-c", "import pydantic"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const env = resolveRealLlmEnv("openrouter", { model: "openai/gpt-4o-mini" });
let work: string | undefined;
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const CODEWORD = "BANANA-77";

const calculator = Tool.create({
  name: "calculator",
  description: "Multiply two integers a and b.",
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  handler: ({ a, b }: { a: number; b: number }) => String(a * b),
});

describe.skipIf(env.shouldSkip)(
  "SE40 real-llm: native transcript --continue across restart",
  () => {
    it("writes a native transcript, then a resumed agent recalls the codeword from disk", async () => {
      work = mkdtempSync(join(tmpdir(), "se40-real-"));

      // 1) real run: a tool call + plant a codeword the follow-up must recall
      const agent = await Agent.create({
        apiKey: env.apiKey,
        model: { id: env.model },
        tools: [calculator],
        systemPrompt:
          "You have a calculator tool. Use it when asked to multiply. Remember any codeword the user gives you.",
        local: { cwd: work, baseDir: work },
      });
      const agentId = agent.agentId;
      try {
        const run = await agent.send(
          `Use the calculator tool to multiply 17 and 23. Also remember this codeword for later: ${CODEWORD}.`,
        );
        const result = await run.wait();
        expect(result.status).toBe("finished");
      } finally {
        await agent.dispose(); // flushes pending transcript writes to disk
      }

      // 2) the native transcript exists on disk at the Claude-shaped path
      const path = transcriptPath(work, work, agentId);
      expect(existsSync(path)).toBe(true);

      // 3) format compatibility — when the real parser clone is present, it accepts the on-disk records
      if (pythonReady()) {
        const out = execFileSync("python3", [VALIDATOR, CLONE, path], { encoding: "utf8" }).trim();
        expect(out).toMatch(/^OK \d+ records, [1-9]\d* tool pairs$/);
      }

      // 4) deterministic --continue substrate: the on-disk DAG reconstructs the prior turns
      const priorRoles = reconstructMessages(await readTranscript(path)).map((m) => m.role);
      expect(priorRoles).toContain("user");
      expect(priorRoles).toContain("assistant");

      // 5) real --continue: a resumed agent hydrates the history and the model recalls the codeword
      const resumed = await Agent.resume(agentId, {
        apiKey: env.apiKey,
        model: { id: env.model },
        local: { cwd: work, baseDir: work },
      });
      try {
        const run = await resumed.send(
          "What was the codeword I asked you to remember? Reply with ONLY the codeword.",
        );
        const result = await run.wait();
        expect(result.status).toBe("finished");
        expect(String(result.result).toUpperCase()).toContain(CODEWORD);
      } finally {
        await resumed.dispose();
      }

      // 6) the follow-up turn was appended to the SAME transcript (never rewritten)
      const finalRoles = reconstructMessages(await readTranscript(path)).map((m) => m.role);
      expect(finalRoles.filter((r) => r === "user").length).toBeGreaterThanOrEqual(2);
    }, 120_000);
  },
);
