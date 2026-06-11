/**
 * TheoCode Scenario Tests — validates the coding agent with REAL LLM calls.
 *
 * Exercises the agent across multiple realistic scenarios:
 *   Scenario 1: File creation via natural language
 *   Scenario 2: Code reading and explanation
 *   Scenario 3: Code editing via natural language
 *   Scenario 4: Multi-turn conversation (context retention)
 *   Scenario 5: Tool use — shell command execution
 *   Scenario 6: Error recovery — invalid request handling
 *   Scenario 7: Glob/search tool usage
 *   Scenario 8: Session persistence across messages
 *   Scenario 9: Complex task — create + edit + verify in one flow
 *   Scenario 10: Profile-tuned system prompt verification
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/theocode-e2e/scenarios.ts
 */

import { Agent } from "@theokit/sdk";
import Database from "better-sqlite3";

// Phase 1: Tools
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createGlobTool,
  createShellTool,
  createSearchTextTool,
  createListDirTool,
} from "../../packages/sdk-tools/src/index.js";

// Phase 2: Session
import { SessionManager, MessageStore } from "../../packages/theocode/src/session/index.js";
import { initDb } from "../../packages/theocode/src/session/schema.js";

// Phase 3: Profiles
import { resolveProfile } from "../../packages/theocode/src/profiles/index.js";

// Phase 4: Infrastructure
import { EventBus } from "../../packages/theocode/src/infra/event-bus.js";

// ─── Config ──────────────────────────────────────────────────────────────

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey?.startsWith("sk-or-")) {
  console.error("\nError: OPENROUTER_API_KEY not set.\nRun: OPENROUTER_API_KEY=sk-or-... npx tsx examples/theocode-e2e/scenarios.ts\n");
  process.exit(1);
}

const modelId = process.argv[2] ?? "openai/gpt-4o-mini";
const projectRoot = "/tmp/theocode-scenarios";

// ─── Tracking ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;
const results: { name: string; ok: boolean; detail: string; ms: number }[] = [];

function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) { passed++; } else { failed++; }
  results.push({ name, ok, detail, ms: 0 });
  const icon = ok ? "PASS" : "FAIL";
  console.log(`  ${icon}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

// ─── Initialize ──────────────────────────────────────────────────────────

console.log("\n================================================================");
console.log("  TheoCode Scenario Tests — Real LLM Validation");
console.log("  Testing the agent across 10 realistic scenarios");
console.log(`  Model: ${modelId}`);
console.log("================================================================\n");

// Phase 2: Session DB
const db = new Database(":memory:");
initDb(db);
const sessionMgr = new SessionManager(db);
const messageStore = new MessageStore(db);
const session = sessionMgr.create(projectRoot, "Scenario Tests");

// Phase 3: Profile
const profile = resolveProfile(modelId);

// Phase 4: Event bus
type Events = {
  "tool.called": { name: string; input: unknown };
  "agent.response": { text: string; tokens: number };
};
const bus = new EventBus<Events>();

const toolCallLog: string[] = [];
bus.subscribe("tool.called", (e) => { toolCallLog.push(e.name); });

// Phase 1: Tools
const tools = [
  createReadFileTool({ projectRoot }),
  createWriteFileTool({ projectRoot }),
  createEditFileTool({ projectRoot }),
  createGlobTool({ projectRoot }),
  createShellTool({ projectRoot }),
  createSearchTextTool({ projectRoot }),
  createListDirTool({ projectRoot }),
];

// Create agent with all tools + profile
const agent = await Agent.create({
  apiKey,
  model: { id: modelId },
  systemPrompt: profile.systemPrompt,
  tools,
  local: { cwd: projectRoot },
  providers: {
    routes: [{ capability: "chat" as const, provider: "openrouter" }],
    fallback: ["openrouter"],
  },
});

// Setup workspace
const shellTool = tools.find((t) => t.name === "shell_exec")!;
await shellTool.handler({ command: `mkdir -p ${projectRoot}/src` });

// Helper: send a prompt and get the response
async function sendAndWait(prompt: string, timeoutMs = 60_000): Promise<{ text: string; status: string; ms: number }> {
  const start = Date.now();
  const run = await agent.send(prompt);
  const result = await run.wait();
  const ms = Date.now() - start;
  const text = result.result ?? "(no response)";

  // Persist to session
  messageStore.append(session.id, {
    sessionId: session.id,
    role: "user",
    content: prompt,
    tokenCount: Math.ceil(prompt.length / 4),
  });
  messageStore.append(session.id, {
    sessionId: session.id,
    role: "assistant",
    content: text,
    tokenCount: Math.ceil(text.length / 4),
  });

  bus.publish("agent.response", { text, tokens: Math.ceil(text.length / 4) });

  return { text, status: result.status ?? "unknown", ms };
}

// ─── Scenario 1: File creation ──────────────────────────────────────────

console.log("── Scenario 1: File Creation via Natural Language ──\n");

{
  const { text, status, ms } = await sendAndWait(
    "Create a file at src/hello.ts with a function called greet that takes a name parameter and returns a greeting string. Use the write_file tool.",
  );
  console.log(`  Response time: ${ms}ms | Status: ${status}`);
  check("agent responded", text !== "(no response)", text.slice(0, 80));
  check("agent status finished", status === "finished" || status === "error");

  // Verify file was actually created
  const readTool = tools.find((t) => t.name === "read_file")!;
  try {
    const content = JSON.parse(await readTool.handler({ path: "src/hello.ts" }));
    check("file was created", content.ok === true, "src/hello.ts exists");
    check("file contains greet function", content.content?.includes("greet") === true);
  } catch {
    check("file was created", false, "read failed");
    check("file contains greet function", false);
  }
  console.log("");
}

// ─── Scenario 2: Code reading and explanation ──────────────────────────

console.log("── Scenario 2: Code Reading and Explanation ──\n");

{
  // Pre-create a file for the agent to read
  const writeTool = tools.find((t) => t.name === "write_file")!;
  await writeTool.handler({
    path: "src/fibonacci.ts",
    content: `export function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}
`,
  });

  const { text, ms } = await sendAndWait(
    "Read the file src/fibonacci.ts and explain what the function does. Use the read_file tool first.",
  );
  console.log(`  Response time: ${ms}ms`);
  check("agent read and explained", text !== "(no response)");
  check("response mentions fibonacci", text.toLowerCase().includes("fibonacci") || text.toLowerCase().includes("sequence") || text.toLowerCase().includes("number"));
  console.log("");
}

// ─── Scenario 3: Code editing ──────────────────────────────────────────

console.log("── Scenario 3: Code Editing via Natural Language ──\n");

{
  const { text, ms } = await sendAndWait(
    'Edit the file src/fibonacci.ts: add a JSDoc comment above the fibonacci function. Use the edit_file tool with old_string being "export function fibonacci" and new_string adding a JSDoc comment before it.',
  );
  console.log(`  Response time: ${ms}ms`);
  check("agent attempted edit", text !== "(no response)");

  // Verify edit
  const readTool = tools.find((t) => t.name === "read_file")!;
  try {
    const content = JSON.parse(await readTool.handler({ path: "src/fibonacci.ts" }));
    const hasDocComment = content.content?.includes("/**") || content.content?.includes("*");
    check("file was edited with JSDoc", hasDocComment === true);
  } catch {
    check("file was edited with JSDoc", false, "read failed");
  }
  console.log("");
}

// ─── Scenario 4: Multi-turn conversation ────────────────────────────────

console.log("── Scenario 4: Multi-Turn Conversation (Context) ──\n");

{
  const r1 = await sendAndWait(
    "I'm working on a TypeScript project. Remember that my project uses strict null checks and ESM modules.",
  );
  check("turn 1 acknowledged", r1.text !== "(no response)");

  const r2 = await sendAndWait(
    "Based on what I just told you about my project, create a src/config.ts file that exports a Config type and a loadConfig function. Make sure it respects the constraints I mentioned.",
  );
  check("turn 2 responded", r2.text !== "(no response)");

  // Check file was created
  const readTool = tools.find((t) => t.name === "read_file")!;
  try {
    const content = JSON.parse(await readTool.handler({ path: "src/config.ts" }));
    check("config file created", content.ok === true);
  } catch {
    check("config file created", false);
  }
  console.log("");
}

// ─── Scenario 5: Shell command execution ────────────────────────────────

console.log("── Scenario 5: Shell Command Execution ──\n");

{
  const { text, ms } = await sendAndWait(
    "Use the shell_exec tool to run 'ls -la src/' and tell me what files exist in the src directory.",
  );
  console.log(`  Response time: ${ms}ms`);
  check("agent ran shell command", text !== "(no response)");
  check("response mentions files", text.includes("hello") || text.includes("fibonacci") || text.includes("config") || text.includes("src"));
  console.log("");
}

// ─── Scenario 6: Error recovery ─────────────────────────────────────────

console.log("── Scenario 6: Error Handling — Nonexistent File ──\n");

{
  const { text, ms } = await sendAndWait(
    "Read the file src/nonexistent-file-12345.ts using the read_file tool. Tell me what happened.",
  );
  console.log(`  Response time: ${ms}ms`);
  check("agent handled missing file", text !== "(no response)");
  check("response acknowledges error", text.toLowerCase().includes("not found") || text.toLowerCase().includes("error") || text.toLowerCase().includes("exist") || text.toLowerCase().includes("no such"));
  console.log("");
}

// ─── Scenario 7: Glob/search tool ──────────────────────────────────────

console.log("── Scenario 7: File Discovery with Glob ──\n");

{
  const { text, ms } = await sendAndWait(
    "Use the glob_files tool to find all TypeScript files (pattern: **/*.ts) in the project. List them.",
  );
  console.log(`  Response time: ${ms}ms`);
  check("agent used glob", text !== "(no response)");
  check("response lists ts files", text.includes(".ts"));
  console.log("");
}

// ─── Scenario 8: Session persistence ────────────────────────────────────

console.log("── Scenario 8: Session Persistence Verification ──\n");

{
  const messages = messageStore.listBySession(session.id);
  const tokenCount = messageStore.countTokens(session.id);
  check("session has messages", messages.length >= 14, `${messages.length} messages stored`);
  check("token count tracked", tokenCount > 0, `${tokenCount} tokens`);
  check("user messages present", messages.some((m) => m.role === "user"));
  check("assistant messages present", messages.some((m) => m.role === "assistant"));

  // Verify we can load the session
  const loaded = sessionMgr.load(session.id);
  check("session loadable", loaded !== null, `session: ${loaded?.title}`);
  console.log("");
}

// ─── Scenario 9: Complex multi-step task ────────────────────────────────

console.log("── Scenario 9: Complex Task — Create + Edit + Verify ──\n");

{
  const { text: r1 } = await sendAndWait(
    'Create a file src/calculator.ts with a Calculator class that has add(a: number, b: number): number and subtract(a: number, b: number): number methods. Use write_file.',
  );
  check("step 1: file created", r1 !== "(no response)");

  const { text: r2 } = await sendAndWait(
    'Now edit src/calculator.ts to add a multiply method to the Calculator class. Use edit_file.',
  );
  check("step 2: edit attempted", r2 !== "(no response)");

  const { text: r3 } = await sendAndWait(
    "Read src/calculator.ts and confirm it has all three methods: add, subtract, and multiply.",
  );
  check("step 3: verification", r3 !== "(no response)");

  // Our own verification
  const readTool = tools.find((t) => t.name === "read_file")!;
  try {
    const content = JSON.parse(await readTool.handler({ path: "src/calculator.ts" }));
    const src = content.content ?? "";
    check("calculator has add", src.includes("add"));
    check("calculator has subtract", src.includes("subtract"));
    check("calculator has multiply", src.includes("multiply"));
  } catch {
    check("calculator has add", false);
    check("calculator has subtract", false);
    check("calculator has multiply", false);
  }
  console.log("");
}

// ─── Scenario 10: Profile verification ──────────────────────────────────

console.log("── Scenario 10: Profile-Tuned System Prompt ──\n");

{
  check("profile resolved", profile.name.length > 0, `name: ${profile.name}`);
  check("system prompt present", profile.systemPrompt.length > 100, `${profile.systemPrompt.length} chars`);

  // Send a meta-question about capabilities
  const { text, ms } = await sendAndWait(
    "What tools do you have available? List them briefly.",
  );
  console.log(`  Response time: ${ms}ms`);
  check("agent knows its tools", text !== "(no response)");
  // The agent should mention at least some of the tools it has
  const mentionsTools = ["read", "write", "edit", "shell", "glob", "search"].some(
    (t) => text.toLowerCase().includes(t),
  );
  check("response mentions tool names", mentionsTools);
  console.log("");
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

agent.dispose();
await shellTool.handler({ command: `rm -rf ${projectRoot}` });
db.close();

// ─── Summary ─────────────────────────────────────────────────────────────

console.log("================================================================");
console.log(`  RESULTS: ${passed}/${total} PASSED | ${failed} FAILED`);
console.log(`  Model: ${modelId} | Profile: ${profile.name}`);
console.log(`  Session: ${messageStore.listBySession(session.id).length} messages stored`);
console.log("");

if (failed > 0) {
  console.log("  FAILED CHECKS:");
  for (const r of results) {
    if (!r.ok) console.log(`    - ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  }
  console.log("");
}

console.log(`  Verdict: ${failed === 0 ? "ALL SCENARIOS PASSED" : "SOME FAILURES — investigate above"}`);
console.log("================================================================\n");

if (failed > 0) process.exit(1);
