/**
 * SE39 — end-to-end real-LLM evidence: run a REAL agent with a tool, tap `writer.onStep`, write the
 * Claude Code transcript, and validate it through the REAL `claude-code-log` parser. Doubly gated:
 * on OPENROUTER_API_KEY (real LLM) AND on the cloned parser + python3/pydantic. This is the
 * `.claude/rules/real-llm-validation.md` proof that the writer works against a real reasoning/tool run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, Tool } from "../../../src/index.js";
import { ClaudeCodeTranscriptWriter } from "../../../src/persistence.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..", "..");
const CLONE = join(REPO, "knowledge-base", "references", "claude-code-log");
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
const skip = env.shouldSkip || !pythonReady();
let work: string | undefined;
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const OPS: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
};

/** Collect tool_use ids + tool_result refs from parsed transcript records. */
function collectPairs(lines: Array<{ message?: { content?: Array<Record<string, unknown>> } }>): {
  useIds: Set<string>;
  resultRefs: Set<string>;
} {
  const useIds = new Set<string>();
  const resultRefs = new Set<string>();
  for (const r of lines) {
    for (const b of r.message?.content ?? []) {
      if (b.type === "tool_use") useIds.add(b.id as string);
      if (b.type === "tool_result") resultRefs.add(b.tool_use_id as string);
    }
  }
  return { useIds, resultRefs };
}

const calculator = Tool.create({
  name: "calculator",
  description: "Compute a op b. op ∈ {add, sub, mul, div}.",
  inputSchema: z.object({ a: z.number(), b: z.number(), op: z.enum(["add", "sub", "mul", "div"]) }),
  handler: ({ a, b, op }) => String(OPS[op]!(a, b)),
});

describe.skipIf(skip)("SE39 real-llm: writer output parses through claude-code-log", () => {
  it("a real tool-calling session is written + parsed with a matching tool pair", async () => {
    work = mkdtempSync(join(tmpdir(), "se39-real-"));
    const writer = ClaudeCodeTranscriptWriter.create({
      cwd: work,
      dir: work,
      sessionId: "se39-real",
      model: env.model,
    });

    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      providers: { routes: [{ capability: "chat", provider: "openrouter" }] },
      tools: [calculator],
      local: { cwd: work },
    });
    const prompt = "Use the calculator tool to compute 17 times 23. Then state the number.";
    try {
      const run = await agent.send(prompt, { onStep: writer.onStep });
      for await (const _ of run.stream()) {
        /* drain */
      }
      await run.wait();
    } finally {
      await agent.dispose();
    }

    const path = await writer.write(prompt);
    expect(existsSync(path)).toBe(true);

    // every line parses via the REAL parser + at least one matched tool pair, zero dangling
    const out = execFileSync("python3", [VALIDATOR, CLONE, path], { encoding: "utf8" }).trim();
    expect(out).toMatch(/^OK \d+ records, [1-9]\d* tool pairs$/);

    // sanity: the persisted transcript actually contains a tool_use + its paired tool_result
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const { useIds, resultRefs } = collectPairs(lines);
    expect(useIds.size).toBeGreaterThan(0);
    for (const id of useIds) expect(resultRefs.has(id)).toBe(true);
  }, 90_000);
});
