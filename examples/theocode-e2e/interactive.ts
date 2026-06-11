/**
 * TheoCode Interactive REPL — talk to a real coding agent in your terminal.
 *
 * Uses ALL 5 TheoCode phases:
 *   Phase 1: Tools (read, write, edit, glob, shell)
 *   Phase 2: Session persistence (SQLite)
 *   Phase 3: Profile selector (model-tuned system prompt)
 *   Phase 4: Permissions + event bus + formatter
 *   Phase 5: TUI logic (theme, status bar, keymap help)
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/theocode-e2e/interactive.ts
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

// Phase 3: Profiles
import { resolveProfile } from "../../packages/theocode/src/profiles/index.js";

// Phase 4: Infrastructure
import { EventBus } from "../../packages/theocode/src/infra/event-bus.js";
import { formatCode } from "../../packages/theocode/src/infra/formatter.js";

// Phase 5: TUI logic
import { getTheme } from "../../packages/theocode/src/tui/theme.js";
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

// ─── Initialize all 5 phases ─────────────────────────────────────────────

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

// Phase 5: Theme
const theme = getTheme("dark");

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

// Create agent with profile + tools
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
  console.log(`\x1b[90mType /help for commands, /quit to exit\x1b[0m\n`);
}

function printStatus() {
  const bar = formatStatusBar({
    model: modelId,
    session: session.title,
    tokens: totalTokens,
    mode: "chat",
  }, process.stdout.columns ?? 80);
  console.log(`\x1b[90m${bar}\x1b[0m`);
}

function printAssistant(text: string) {
  console.log(`\n\x1b[32m  Assistant:\x1b[0m ${text}\n`);
}

function printSystem(text: string) {
  console.log(`\x1b[33m  [system]\x1b[0m ${text}`);
}

printHeader();

function prompt() {
  rl.question(`\x1b[36m  You > \x1b[0m`, async (input) => {
    const trimmed = input.trim();

    if (!trimmed) { prompt(); return; }

    // Commands
    if (trimmed === "/quit" || trimmed === "/exit") {
      printSystem("Goodbye!");
      printStatus();
      agent.dispose();
      db.close();
      rl.close();
      return;
    }

    if (trimmed === "/help") {
      console.log(`\n${formatKeymapHelp()}`);
      console.log(`  /help    — show this help`);
      console.log(`  /status  — show session status`);
      console.log(`  /tools   — list available tools`);
      console.log(`  /session — show session info`);
      console.log(`  /quit    — exit TheoCode\n`);
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
      console.log(`\n  Session: ${session.title} (${session.id.slice(0, 8)}...)`);
      console.log(`  Messages: ${msgs.length}`);
      console.log(`  Tokens: ${totalTokens}`);
      console.log(`  Model: ${modelId}`);
      console.log(`  Profile: ${profile.name}\n`);
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
    console.log(`\x1b[90m  Thinking...\x1b[0m`);

    try {
      const run = await agent.send(trimmed);
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
