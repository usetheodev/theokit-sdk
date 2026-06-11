/**
 * TheoCode Interactive REPL — a mini Claude Code powered by TheoKit SDK.
 *
 * Features:
 *   - 7 coding tools (read, write, edit, glob, shell, search, list_dir)
 *   - Plan mode (read-only planning before execution)
 *   - Todolist (multi-step task tracking)
 *   - Task subagent (delegate sub-tasks to child agents)
 *   - Model-tuned system prompts (anthropic/openai/gemini/default)
 *   - Session persistence (SQLite in-memory)
 *   - Rich system prompt (Claude Code / OpenCode style)
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/theocode-e2e/interactive.ts [model]
 */

import * as readline from "node:readline";
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

// Phase 3: Profiles + Tools
import { resolveProfile } from "../../packages/theocode/src/profiles/index.js";
import { createPlanModeTool } from "../../packages/theocode/src/tools/plan-mode.js";
import { createTodolistTool } from "../../packages/theocode/src/tools/todolist.js";
import { createTaskAgentTool } from "../../packages/theocode/src/tools/task-agent.js";

// Phase 4: Infrastructure
import { EventBus } from "../../packages/theocode/src/infra/event-bus.js";

// Phase 5: TUI logic
import { formatStatusBar } from "../../packages/theocode/src/tui/status-bar.js";
import { formatKeymapHelp } from "../../packages/theocode/src/tui/keymap.js";

// ─── Config ──────────────────────────────────────────────────────────────

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey?.startsWith("sk-or-")) {
  console.error("\nError: OPENROUTER_API_KEY not set.\nRun: OPENROUTER_API_KEY=sk-or-... npx tsx examples/theocode-e2e/interactive.ts\n");
  process.exit(1);
}

const modelId = process.argv[2] ?? "openai/gpt-4o-mini";
const projectRoot = process.cwd();

// ─── Initialize ──────────────────────────────────────────────────────────

// Phase 2: Session DB
const db = new Database(":memory:");
initDb(db);
const sessionMgr = new SessionManager(db);
const messageStore = new MessageStore(db);
const session = sessionMgr.create(projectRoot, "Interactive Session");

// Phase 3: Profile
const profile = resolveProfile(modelId);

// Phase 4: Event bus
type Events = { "message.sent": { role: string }; "message.received": { role: string; tokens: number } };
const bus = new EventBus<Events>();

// Phase 3: Advanced tools (plan mode + todolist)
const planMode = createPlanModeTool();
const todolist = createTodolistTool();

// Phase 1: Coding tools
const codingTools = [
  createReadFileTool({ projectRoot }),
  createWriteFileTool({ projectRoot }),
  createEditFileTool({ projectRoot }),
  createGlobTool({ projectRoot }),
  createShellTool({ projectRoot }),
  createSearchTextTool({ projectRoot }),
  createListDirTool({ projectRoot }),
];

// All tools (coding + plan + todo — task added after agent creation)
const allTools = [
  ...codingTools,
  planMode,
  todolist,
];

// Create agent
const agent = await Agent.create({
  apiKey,
  model: { id: modelId },
  systemPrompt: profile.systemPrompt,
  tools: allTools,
  local: { cwd: projectRoot },
  providers: {
    routes: [{ capability: "chat" as const, provider: "openrouter" }],
    fallback: ["openrouter"],
  },
});

// Task subagent (needs agent reference)
const taskAgent = createTaskAgentTool({ agent, timeoutMs: 120_000 });

// Rebuild tools list with task agent
const tools = [...allTools, taskAgent];

// Re-create agent with all tools including task
agent.dispose();
const fullAgent = await Agent.create({
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

// ─── REPL ────────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let totalTokens = 0;

function printHeader() {
  console.log(`\n\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[1mTheoCode\x1b[0m — Coding Agent powered by TheoKit SDK  \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m`);
  console.log(`\x1b[90mModel: ${modelId} | Profile: ${profile.name} | Tools: ${tools.length}\x1b[0m`);
  console.log(`\x1b[90mProject: ${projectRoot}\x1b[0m`);
  console.log(`\x1b[90mCapabilities: plan_mode, todolist, task_subagent, 7 coding tools\x1b[0m`);
  console.log(`\x1b[90mType /help for commands, /quit to exit\x1b[0m\n`);
}

function printStatus() {
  const mode = planMode.currentMode();
  const modeTag = mode === "plan" ? " [PLAN MODE]" : "";
  const bar = formatStatusBar({
    model: modelId,
    session: session.title + modeTag,
    tokens: totalTokens,
    mode: mode === "plan" ? "plan" : "chat",
  }, process.stdout.columns ?? 80);
  console.log(`\x1b[90m${bar}\x1b[0m`);
}

function printAssistant(text: string) {
  // Colorize code blocks
  const formatted = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `\x1b[90m\`\`\`${lang ?? ""}\x1b[0m\n\x1b[33m${code}\x1b[0m\x1b[90m\`\`\`\x1b[0m`;
  });
  console.log(`\n\x1b[32m  Assistant:\x1b[0m ${formatted}\n`);
}

function printSystem(text: string) {
  console.log(`\x1b[33m  [system]\x1b[0m ${text}`);
}

printHeader();

function prompt() {
  const modePrefix = planMode.currentMode() === "plan" ? "\x1b[35m[plan]\x1b[36m" : "\x1b[36m";
  rl.question(`${modePrefix}  You > \x1b[0m`, async (input) => {
    const trimmed = input.trim();

    if (!trimmed) { prompt(); return; }

    // Built-in commands
    if (trimmed === "/quit" || trimmed === "/exit") {
      printSystem("Goodbye!");
      printStatus();
      fullAgent.dispose();
      db.close();
      rl.close();
      return;
    }

    if (trimmed === "/help") {
      console.log(`\n${formatKeymapHelp()}`);
      console.log(`  /help     — show this help`);
      console.log(`  /status   — show session status`);
      console.log(`  /tools    — list available tools`);
      console.log(`  /session  — show session info`);
      console.log(`  /plan     — enter plan mode (read-only planning)`);
      console.log(`  /build    — exit plan mode (start executing)`);
      console.log(`  /todo     — show current task list`);
      console.log(`  /quit     — exit TheoCode\n`);
      prompt();
      return;
    }

    if (trimmed === "/status") {
      printStatus();
      prompt();
      return;
    }

    if (trimmed === "/tools") {
      console.log(`\n  Available tools (${tools.length}):`);
      for (const t of tools) {
        console.log(`    - ${t.name}: ${t.description?.slice(0, 60) ?? ""}`);
      }
      console.log("");
      prompt();
      return;
    }

    if (trimmed === "/session") {
      const msgs = messageStore.listBySession(session.id);
      const mode = planMode.currentMode();
      console.log(`\n  Session: ${session.title} (${session.id.slice(0, 8)}...)`);
      console.log(`  Messages: ${msgs.length}`);
      console.log(`  Tokens: ${totalTokens}`);
      console.log(`  Model: ${modelId}`);
      console.log(`  Profile: ${profile.name}`);
      console.log(`  Mode: ${mode}`);
      console.log(`  Tasks: ${taskAgent.getHistory().length} delegated\n`);
      prompt();
      return;
    }

    if (trimmed === "/plan") {
      const result = JSON.parse(planMode.handler({ action: "enter" }));
      printSystem(result.message);
      prompt();
      return;
    }

    if (trimmed === "/build") {
      const result = JSON.parse(planMode.handler({ action: "exit" }));
      printSystem(result.message);
      prompt();
      return;
    }

    if (trimmed === "/todo") {
      const result = JSON.parse(todolist.handler({ action: "list" }));
      console.log(`\n  ${result.items_summary.split("\n").join("\n  ")}\n`);
      prompt();
      return;
    }

    // Save user message
    messageStore.append(session.id, {
      sessionId: session.id,
      role: "user",
      content: trimmed,
      tokenCount: Math.ceil(trimmed.length / 4),
    });
    bus.publish("message.sent", { role: "user" });

    // Send to agent
    const mode = planMode.currentMode();
    const modeHint = mode === "plan"
      ? "\n[You are in PLAN MODE. Only read and search — do NOT make changes. Outline your plan with numbered steps.]"
      : "";

    console.log(`\x1b[90m  Thinking...\x1b[0m`);

    try {
      const run = await fullAgent.send(trimmed + modeHint);
      const result = await run.wait();

      const responseText = result.result ?? "(no response)";
      const estimatedTokens = Math.ceil(responseText.length / 4);
      totalTokens += estimatedTokens;

      // Save assistant message
      messageStore.append(session.id, {
        sessionId: session.id,
        role: "assistant",
        content: responseText,
        tokenCount: estimatedTokens,
      });
      bus.publish("message.received", { role: "assistant", tokens: estimatedTokens });

      printAssistant(responseText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n\x1b[31m  Error:\x1b[0m ${msg}\n`);
    }

    prompt();
  });
}

prompt();
