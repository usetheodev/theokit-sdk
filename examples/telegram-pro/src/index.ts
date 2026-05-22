import { Security } from "@usetheo/sdk";
// @usetheo/gateway FULL migration (Phase 7, ADRs D170-D181).
// The runner orchestrates lifecycle + slash dispatch + hook chain.
// `adapter.getBot()` exposes grammy's Bot for non-portable events
// (callback_query, bot.catch).
import type { GatewayHook, MessageEvent } from "@usetheo/gateway";
import { GatewayRunner } from "@usetheo/gateway";
import {
  type PolicyContext,
  TelegramAdapter,
  shouldRespondInChat,
  splitForTelegram,
  stripBotMention,
} from "@usetheo/gateway-telegram";
import { type Context, GrammyError, HttpError, InputFile } from "grammy";

import { AD_HOC_TOOLS, listAdHocTools } from "./ad-hoc-tools.js";
import { SYSTEM_PROMPT, getAgent, resolveAgentId, resolveUserId } from "./agent.js";
import { decodeCallback, extractButtons, isAgentCallback } from "./buttons.js";
import {
  initCron,
  listCronJobs,
  runDreamNow,
  scheduleReminder,
} from "./cron-setup.js";
import { ensureHooksPolicy } from "./hooks-setup.js";
import { listLoops, scheduleLoop, stopAllLoopsForChat, stopLoop } from "./loops.js";
import { listFacts } from "./memory-store.js";
import type { z } from "zod";

import { getStreamMode, setStreamMode, streamIntoTelegram } from "./streaming.js";
import { readSkillFile } from "./workspace-seeds.js";
import { buildMcpServers } from "./sdk-config.js";
import { NoTranscriberError, transcribeAudio } from "./transcribe.js";
import { describeImage } from "./vision.js";
import { searchWiki } from "./wiki-search.js";
import { seedWorkspace } from "./workspace-seeds.js";

/**
 * Theo Pro — multimodal Telegram bot built on @usetheo/sdk 1.0.0.
 *
 * Reproduces the 5 highest-value patterns from OpenClaw's `extensions/telegram`:
 *   1. Voice transcription   (text/audio → Whisper → agent)
 *   2. Sticker/photo vision  (image → Gemini multimodal → agent)
 *   3. Inline buttons        (agent emits [BUTTONS: A | B] → keyboard)
 *   4. Group @-mention gating (reply only when called by name in groups)
 *   5. Forum-topic scoping   (each thread = isolated agent + session JSONL)
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TOKEN === undefined || TOKEN.length === 0) {
  console.error("Missing TELEGRAM_BOT_TOKEN. See README §Setup.");
  process.exit(1);
}
const API_KEY = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
if (API_KEY === undefined || API_KEY.length === 0) {
  console.error("Missing THEOKIT_API_KEY / OPENROUTER_API_KEY.");
  process.exit(1);
}
const CWD = process.cwd();

const ALLOWED_USERS = new Set(
  (process.env.TELEGRAM_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

// Gateway wires under the hood. `adapter.getBot()` exposes grammy's Bot
// for non-portable events (callback_query, bot.catch). The runner is what
// we call `start()`/`stop()` on — it owns adapter lifecycle.
const adapter = new TelegramAdapter({ token: TOKEN });
const bot = adapter.getBot();
const opts = { apiKey: API_KEY, cwd: CWD };
let policy: PolicyContext | undefined; // initialized after runner.start()

// Allowlist + redact-log hook (replaces `bot.use(...)`). Fires before
// every inbound event (text and media). `{ block: true, message }`
// short-circuits + auto-replies (EC-D).
const allowlistRedactHook: GatewayHook = {
  name: "allowlist-redact",
  pre_inbound: ({ event }) => {
    if (event.platform !== "telegram") return undefined;
    const userId = event.sender.id;
    const ts = new Date().toISOString();
    const text = event.text.length > 0 ? event.text : "(non-text)";
    console.log(
      `[${ts}] user=${userId} chat=${event.channel.type} text=${Security.redact(text).slice(0, 80)}`,
    );
    if (ALLOWED_USERS.size > 0 && !ALLOWED_USERS.has(userId)) {
      return {
        block: true,
        message: `Sorry — this bot is restricted. Your user id is \`${userId}\`.`,
      };
    }
    return undefined;
  },
};

// Default handler — fires for inbound that DIDN'T match a runner.command.
// Routes media (voice/photo/sticker/text) via the grammy Context escape
// hatch (D180).
async function defaultHandler(event: MessageEvent): Promise<void> {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const msg = ctx.message;
  if (msg === undefined) return;
  if (msg.voice !== undefined) return handleVoice(ctx);
  if (msg.photo !== undefined) return handlePhoto(ctx);
  if (msg.sticker !== undefined) return handleSticker(ctx);
  if (msg.text !== undefined && !msg.text.startsWith("/")) return handleText(ctx);
}

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: defaultHandler,
  hooks: [allowlistRedactHook],
});

// ────────────────────── slash commands ──────────────────────

runner.command("start", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const agent = await getAgent(ctx, opts);
  try {
    await ctx.reply(
      [
        "Welcome to *Theo Pro* — multimodal personal assistant.",
        "",
        "*What I understand:*",
        "• Text messages — natural chat with memory + recall",
        "• Voice messages — I transcribe via Whisper and reply",
        "• Photos / stickers — I describe them via vision, reply to what I see",
        "",
        "*What I can offer:*",
        "• Inline buttons — when I ask a question, I'll show tap-options",
        "• Group support — add me to a group; I reply when @-mentioned",
        "• Forum topics — each topic is its own isolated thread",
        "",
        `Your user id: \`${resolveUserId(ctx)}\`. Agent id (this thread): \`${resolveAgentId(ctx)}\`.`,
        "",
        "💡 Try `/stream on` for ChatGPT-like incremental replies (Telegram editMessageText throttled).",
        "Send /help for commands.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } finally {
    await agent.dispose();
  }
});

runner.command("help", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  await ctx.reply(
    [
      "*Theo Pro — commands*",
      "/start /help — basics",
      "/me — what I remember about you (MEMORY.md)",
      "/recall <q> — search past conversations (corpus=\"sessions\")",
      "/wiki <q> — search the wiki corpus (`.theokit/memory/wiki/`)",
      "/agents — list subagent specialists I can delegate to",
      "/skills — list loaded skills (from `.theokit/skills/`)",
      "/fact <topic> — structured fact card via Agent.generateObject (v1.1)",
      "/factstream <topic> — like /fact but with streamObject + incremental edits (v1.2)",
      "/migrate_memory — demo of theokit-migrate-memory CLI (dry-run, isolated tmpdir, v1.2)",
      "/memory_lance — opt-in LanceDB backend config showcase (v1.2)",
      "/notion — Notion MCP via OAuth 2.1 PKCE (requires NOTION_OAUTH_CLIENT_ID, v1.2)",
      "/stream on|off — toggle incremental editMessageText streaming (v1.2)",
      "/personality [<name>|none] — activate a preset from `.theokit/personalities/` (v1.14, Hermes #26)",
      "/skill <name> — drill into a specific skill's SKILL.md content",
      "/summary — run dreaming sweep (dedup + cluster facts)",
      "/cron — list scheduled jobs",
      "/remind <cron> | <msg> — schedule a recurring reminder (cron syntax)",
      "/loop <30s|2m|1h> <prompt> — recurring agent.send delivered to this chat",
      "/loops — list active loops",
      "/stop_loop <id> — stop one loop (or `/stop_loop all` to stop all)",
      "/tool <name> <args> — ad-hoc tool via per-call override (`/tool list` to see registry)",
      "/goal <prompt> — Agent.runUntil(goal) Ralph loop with judge model (v1.3)",
      "/pool [status|stress] — credential pool status + 5-call stress test (v1.10)",
      "/batch <topic> — 3 parallel prompts via Agent.batch (concurrency 3, v1.11)",
      "/handoff_demo (question) — triage agent → billing/support via handoffs array (v1.16)",
      "/workflow_demo (claim) — declarative 4-step pipeline: validate → classify → branch → resolve (v1.17)",
      "/cache_demo (question) — semantic cache: 2nd paraphrase hits without LLM call (v1.18)",
      "/memory <provider> <topic> — third-party memory adapter (supermemory/honcho/mem0, v1.12)",
      "/context — list discovered context files (AGENTS.md, CLAUDE.md, etc., v1.13)",
      "/reset — clear this thread's history (memory facts stay)",
      "",
      "*Modes detected automatically:*",
      "• voice → transcribe → reply",
      "• photo/sticker → describe → reply",
      "• inline buttons when offering options",
      "• `ls`, `cat`, `grep` → shell (policy-gated)",
      "• create/read/edit files → filesystem MCP",
      "• 🌐 web search → Tavily MCP (when TAVILY_API_KEY is in .env)",
      "• complex code/research tasks → I delegate to subagents",
    ].join("\n"),
    // Plain text — command names with underscores (/migrate_memory, /handoff_demo)
    // break Markdown V1 italic parsing. Help is a static list; markdown
    // formatting is cosmetic, correctness > prettiness.
  );
});

runner.command("me", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const facts = await listFacts(CWD);
  if (facts.length === 0) {
    await ctx.reply(
      "I don't remember anything about you yet. Say something like `Remember: meu time é Corinthians.` and I'll persist it to MEMORY.md.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  const lines = facts.map((f) => `${f.index}. ${f.text}`).join("\n");
  await ctx.reply(`*What I remember about you*\n\n${lines}`, { parse_mode: "Markdown" });
});

runner.command("recall", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const query = match;
  if (query.length === 0) {
    await ctx.reply("Usage: `/recall vitest` — searches past conversations via corpus=\"sessions\".", {
      parse_mode: "Markdown",
    });
    return;
  }
  await ctx.replyWithChatAction("typing");
  await dispatchToAgent(
    ctx,
    `Use memory_search with corpus="sessions" to find past conversations about: ${query}. List the top 3 matches with a one-line summary each. If nothing matches, say so.`,
  );
});

runner.command("wiki", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const query = match;
  if (query.length === 0) {
    await ctx.reply(
      "Usage: `/wiki tools` — searches `.theokit/memory/wiki/*.md` directly.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  // Direct server-side search — bypasses the LLM. gemini-flash was unreliable
  // with the multi-step "grep then cat" tool flow (would hallucinate "no match"
  // or print the cat command as text instead of executing it).
  const hits = await searchWiki(CWD, query);
  if (hits.length === 0) {
    await ctx.reply(`Não há entrada na wiki sobre "${query}".`);
    return;
  }
  for (const hit of hits.slice(0, 3)) {
    const body = `*${hit.filename}*\n\n\`\`\`\n${hit.excerpt.slice(0, 3500)}\n\`\`\``;
    await ctx.reply(body, { parse_mode: "Markdown" });
  }
  if (hits.length > 3) {
    await ctx.reply(`_(...${hits.length - 3} match(es) extra omitido(s).)_`, { parse_mode: "Markdown" });
  }
});

runner.command("agents", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  await ctx.reply(
    [
      "*Subagents declared* (`agents:` in Agent.create):",
      "• *code_writer* — TypeScript / Node.js coding specialist",
      "• *researcher* — Deep-dive analyst & summarizer",
      "",
      "⚠️ *Limitation*: subagent dispatch via the `task` tool is *cloud-only* in SDK v1.0.",
      "The local runtime does NOT expose a `task` tool, so the primary agent can't delegate to these specialists here.",
      "The declarations still serialize cleanly to the cloud payload — they'll work once the agent runs on Theo PaaS.",
      "",
      "*Workaround for local*: ask me directly (`me ajuda a refatorar X`) — I still call shell/MCP tools end-to-end.",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
});

runner.command("skills", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const agent = await getAgent(ctx, opts);
  try {
    type WithSkills = { skills?: { list: () => Promise<Array<{ name: string; description: string }>> } };
    const skillsHandle = (agent as unknown as WithSkills).skills;
    const skills = skillsHandle !== undefined ? await skillsHandle.list() : [];
    if (skills.length === 0) {
      await ctx.reply(
        "No skills loaded. Drop a `.theokit/skills/<name>/SKILL.md` (with `name` + `description` YAML frontmatter) and restart.",
      );
      return;
    }
    const lines = skills.map((s) => `• *${s.name}* — ${s.description}`);
    await ctx.reply(`*Loaded skills*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  } finally {
    await agent.dispose();
  }
});

// ────────────────────── /fact — Agent.generateObject showcase ──────────────────────
//
// Demonstrates the v1.1 `Agent.generateObject<T>` (ADR D33). Given a topic,
// the model is forced to call a synthetic `output` tool whose handler captures
// the structured value matching the Zod schema. No string parsing, no regex,
// no JSON.parse — Zod enforces shape and types end-to-end.
runner.command("fact", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const topic = match;
  if (topic.length === 0) {
    await ctx.reply(
      [
        "*Usage:* `/fact <topic>`",
        "",
        "Returns a structured fact card via `Agent.generateObject<T>`.",
        "Example: `/fact corinthians` → `{ title, summary, year, sources[] }`",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const { Agent } = await import("@usetheo/sdk");
    const { z } = await import("zod");
    const schema = z.object({
      title: z.string().min(1).describe("Short title of the fact (1 line)."),
      summary: z.string().min(20).describe("2-3 sentence summary."),
      year: z.number().int().nullable().describe("Year of the event, or null if not applicable."),
      sources: z.array(z.string()).min(1).max(3).describe("Up to 3 source descriptions (free text — no URLs needed)."),
    });
    const t0 = Date.now();
    const out = await Agent.generateObject({
      apiKey: API_KEY,
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      schema,
      systemPrompt:
        "You produce a structured fact card. Match the schema exactly. Keep summary 2-3 sentences. Set year to null if unknown.",
      prompt: `Produce a fact card about: ${topic}`,
    });
    const elapsed = Date.now() - t0;
    const sources = out.object.sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const yearText = out.object.year === null ? "(n/a)" : String(out.object.year);
    await ctx.reply(
      [
        `*${out.object.title}*`,
        "",
        out.object.summary,
        "",
        `*Year:* ${yearText}`,
        "*Sources:*",
        sources,
        "",
        `_generated in ${elapsed}ms · ${out.usage.inputTokens}/${out.usage.outputTokens} tokens · Agent.generateObject_`,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Fact generation failed: ${msg.slice(0, 400)}`);
  }
});

// ────────────────────── /batch — Agent.batch showcase (v1.11, ADRs D134-D140) ──────────────────────
//
// Fans out 3 mini-prompts (haiku, joke, fact) about a topic via
// `Agent.batch(prompts, { concurrency: 3 })`. Validates the end-to-end
// batch surface (semaphore + per-prompt isolation + result ordering)
// against a real LLM. Failures-per-prompt are surfaced inline so the
// user sees the discriminated-union contract in action.
runner.command("batch", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const topic = match;
  if (topic.length === 0) {
    await ctx.reply(
      [
        "*Usage:* `/batch <topic>`",
        "",
        "Runs 3 mini-prompts in parallel via `Agent.batch` (concurrency 3):",
        "• one-line haiku",
        "• one-line joke",
        "• one-line surprising fact",
        "",
        "Example: `/batch jazz`",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const { Agent } = await import("@usetheo/sdk");
    const t0 = Date.now();
    const results = await Agent.batch(
      [
        `Write a one-line haiku (5-7-5 syllables joined with " / ") about ${topic}. Reply with only the haiku.`,
        `Tell a one-line joke about ${topic}. Reply with only the joke.`,
        `Share one surprising one-line fact about ${topic}. Reply with only the fact.`,
      ],
      {
        apiKey: API_KEY,
        model: { id: "openai/gpt-4o-mini" },
        local: { cwd: CWD, sandboxOptions: { enabled: false } },
        concurrency: 3,
      },
    );
    const dt = Date.now() - t0;
    const lines = results.map((r, i) => {
      if (r.ok) {
        const text = (r.result.result ?? "").trim().slice(0, 200);
        return `${i + 1}. ${text}`;
      }
      return `${i + 1}. failed: ${r.error.message.slice(0, 80)}`;
    });
    await ctx.reply(
      `Batch (${dt}ms, 3 prompts parallel via Agent.batch):\n${lines.join("\n")}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Batch failed: ${msg.slice(0, 400)}`);
  }
});

// ────────────────────── /memory — third-party memory adapters (v1.12, ADRs D141-D149) ──────────────────────
//
// Demonstrates @usetheo/memory-{supermemory,honcho,mem0} adapters via
// agent.memory.write/recall + LLM-driven pre_user_send context injection.
// Each provider is env-gated — missing key → polite error, NOT a crash.
runner.command("memory", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const args = match.trim().split(/\s+/);
  const provider = args[0] ?? "";
  const topic = args.slice(1).join(" ").trim();
  if (provider === "" || topic === "") {
    await ctx.reply(
      [
        "*Usage:* `/memory <provider> <topic>`",
        "",
        "Provider: `supermemory` · `honcho` · `mem0`",
        "Example: `/memory supermemory jazz`",
        "",
        "Each provider is opt-in via env var (SUPERMEMORY_API_KEY / HONCHO_API_KEY / MEM0_API_KEY).",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  const envName =
    provider === "supermemory"
      ? "SUPERMEMORY_API_KEY"
      : provider === "honcho"
        ? "HONCHO_API_KEY"
        : provider === "mem0"
          ? "MEM0_API_KEY"
          : "";
  if (envName === "") {
    await ctx.reply(`Unknown provider: ${provider}. Use supermemory, honcho, or mem0.`);
    return;
  }
  const apiKey = process.env[envName];
  if (apiKey === undefined || apiKey === "") {
    await ctx.reply(`Set ${envName} in .env to use the ${provider} adapter.`);
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const { Agent } = await import("@usetheo/sdk");
    let memoryPlugin: unknown;
    if (provider === "supermemory") {
      const { supermemoryMemory } = await import("@usetheo/memory-supermemory");
      memoryPlugin = supermemoryMemory({
        apiKey,
        containerTagPrefix: `theokit-tg-${Date.now()}`,
      });
    } else if (provider === "honcho") {
      const { honchoMemory } = await import("@usetheo/memory-honcho");
      memoryPlugin = honchoMemory({ apiKey });
    } else {
      const { mem0Memory } = await import("@usetheo/memory-mem0");
      memoryPlugin = mem0Memory({ apiKey });
    }
    const userId = String(ctx.from?.id ?? "demo-user");
    const agent = await Agent.create({
      apiKey: API_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      plugins: [memoryPlugin] as unknown as import("@usetheo/sdk").AgentOptions["plugins"],
      memoryContext: { userId },
    });
    try {
      // Write 3 facts about the topic
      await agent.memory!.write(`User is curious about ${topic}.`);
      await agent.memory!.write(`Three notable artists in ${topic}: A, B, C.`);
      await agent.memory!.write(`Common terms in ${topic} discussions: rhythm, harmony.`);

      // Recall
      const facts = await agent.memory!.recall(`information about ${topic}`, undefined, 3);
      const recallLines =
        facts.length === 0
          ? "(no facts recalled)"
          : facts
              .map((f, i) => `${i + 1}. [${f.score?.toFixed(2) ?? "?"}] ${f.content.slice(0, 100)}`)
              .join("\n");

      await ctx.reply(
        [
          `*Memory adapter:* ${provider}`,
          "",
          `*Wrote 3 facts* about ${topic}.`,
          "",
          `*Recalled (k=3):*\n${recallLines}`,
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    } finally {
      await agent.dispose();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`/memory ${provider} failed: ${msg.slice(0, 300)}`);
  }
});

// ────────────────────── /context — context-file discovery showcase (v1.13, ADRs D150-D159) ──────────────────────
//
// Lists every context file FileContextManager discovered from the
// repo: AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc,
// .theokit/context/*.md, .theokit/THEO.md. Demonstrates walk-up,
// @import resolution, and aggregate cap status.
runner.command("context", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  await ctx.replyWithChatAction("typing");
  try {
    const { Agent } = await import("@usetheo/sdk");
    const agent = await Agent.create({
      apiKey: API_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      context: { manager: "file" },
    });
    try {
      const snap = await agent.context!.snapshot();
      if (snap.sources.length === 0) {
        await ctx.reply("Context files discovered: (none)");
        return;
      }
      const lines = snap.sources.map((s) => {
        const status = s.status === "summarized" ? " (truncated)" : "";
        return `• ${s.name}${status}`;
      });
      const usedTokens = snap.budget?.usedTokens;
      const tokenCount = Array.isArray(usedTokens) ? usedTokens.length : 0;
      await ctx.reply(
        `Context files discovered:\n${lines.join("\n")}\n\n(${tokenCount} token-chunks total)`,
      );
    } finally {
      await agent.dispose();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`/context failed: ${msg.slice(0, 300)}`);
  }
});

// ────────────────────── /factstream — Agent.streamObject showcase (v1.2) ──────────────────────
//
// Like /fact, but streams partials via Agent.streamObject<T> (ADR D39).
// Some providers (Gemini/Anthropic) batch tool_use output — partials may
// be zero; in that case only the final `complete` event arrives. The 500ms
// throttle on editMessageText keeps Telegram rate-limit happy (ADR D52).
runner.command("factstream", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const topic = match;
  if (topic.length === 0) {
    // Plain text — "Agent.streamObject<T>" and "tool_use" contain "_<" that
    // breaks Markdown V1 entity parsing.
    await ctx.reply(
      [
        "Usage: /factstream <topic>",
        "",
        "Like /fact but streams partials via Agent.streamObject<T> (v1.2 ADR D39).",
        "Some providers (Gemini/Anthropic) batch tool_use output — you may see only the final object.",
      ].join("\n"),
    );
    return;
  }
  await ctx.replyWithChatAction("typing");
  let placeholder: Awaited<ReturnType<typeof ctx.reply>> | undefined;
  try {
    placeholder = await ctx.reply("⏳ Streaming object...");
  } catch (err) {
    console.error("[/factstream] initial reply failed:", err);
    return;
  }
  if (placeholder?.message_id === undefined) return;
  const msgId = placeholder.message_id;
  const chatId = placeholder.chat.id;

  try {
    const { Agent } = await import("@usetheo/sdk");
    const { z } = await import("zod");
    const schema = z.object({
      title: z.string().min(1),
      summary: z.string().min(20),
      year: z.number().int().nullable(),
      sources: z.array(z.string()).min(1).max(3),
    });
    type FactCard = z.infer<typeof schema>;
    const t0 = Date.now();
    let partialCount = 0;
    let lastEditAt = 0;
    let final:
      | {
          object: FactCard;
          usage: { inputTokens: number; outputTokens: number };
        }
      | undefined;

    // Gemini 2.0 Flash sometimes returns plain text instead of calling the
     // structured `output` tool (Gemini-specific quirk documented in usage
     // text above). GPT-4o-mini is much more reliable for streamObject /
     // Zod-schema flows — same OpenRouter API key, marginal cost difference,
     // deterministic tool calling. When TELEGRAM_PRO_MODEL is set to a local
     // runtime (ollama/...), fall through to that model — small local models
     // may not produce structured output reliably (capability gap, not bug).
    const streamObjectModel = (() => {
      const m = process.env.TELEGRAM_PRO_MODEL ?? "";
      return /^(ollama|lmstudio|llamacpp|lm-studio|llama-cpp|llama\.cpp)\//.test(m)
        ? m
        : "openai/gpt-4o-mini";
    })();
    // Forward bot-level provider routing so streamObject's transient agent
    // knows to use OpenRouter when `model.id` uses `openai/...` shape but the
    // credential is OPENROUTER_API_KEY (not OPENAI_API_KEY). Without this the
    // transient agent fails with `provider_unresolved` before the LLM is even
    // called (see SDK fix surfacing this as a clearer error).
    const { buildProviderRouting } = await import("./sdk-config.js");
    const factstreamProviders = buildProviderRouting();
    for await (const evt of Agent.streamObject({
      apiKey: API_KEY,
      model: { id: streamObjectModel },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      schema,
      systemPrompt:
        "Match schema exactly. Keep summary 2-3 sentences. year=null if unknown.",
      prompt: `Produce a fact card about: ${topic}`,
      ...(factstreamProviders !== undefined ? { providers: factstreamProviders } : {}),
    })) {
      if (evt.type === "partial") {
        partialCount += 1;
        // 500ms throttle (D52).
        if (Date.now() - lastEditAt >= 500) {
          // EC-5: drop parse_mode in preview — raw text avoids markdown parse
          // failures on unescaped `_` `*` chars in partial JSON.
          const preview = `⏳ Streaming (partial ${evt.attempt}):\n${JSON.stringify(evt.partial, null, 2).slice(0, 3500)}`;
          try {
            await ctx.api.editMessageText(chatId, msgId, preview);
          } catch {
            // ignore "not modified" / "message to edit not found"
          }
          lastEditAt = Date.now();
        }
      } else if (evt.type === "complete") {
        final = evt;
      }
    }
    const elapsed = Date.now() - t0;
    if (final === undefined) {
      await ctx.api.editMessageText(chatId, msgId, "❌ No complete event from streamObject.");
      return;
    }
    const sources = final.object.sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const yearText = final.object.year === null ? "(n/a)" : String(final.object.year);
    // Plain text — title/summary/sources are LLM output and may contain
    // arbitrary "_*[]" that breaks Markdown V1 parsing.
    await ctx.api.editMessageText(
      chatId,
      msgId,
      [
        final.object.title,
        "",
        final.object.summary,
        "",
        `Year: ${yearText}`,
        "Sources:",
        sources,
        "",
        `streamed in ${elapsed}ms · ${partialCount} partial(s) · ${final.usage.inputTokens}/${final.usage.outputTokens} tokens · Agent.streamObject`,
      ].join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await ctx.api.editMessageText(chatId, msgId, `❌ Streaming failed: ${msg.slice(0, 400)}`);
    } catch {
      // best-effort
    }
  }
});

// ────────────────────── /migrate_memory — Migration CLI demo (v1.2) ──────────────────────
//
// Isolated dry-run demo: creates a tmpdir, seeds 3 fake facts, runs
// migrateSqliteToLance({ dryRun: true }), reports result. NEVER touches
// the bot's real .theokit/memory/ (ADR D56).
runner.command("migrate_memory", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  await ctx.replyWithChatAction("typing");
  // Plain text — message contains "_" (migrateSqliteToLance, dryRun, etc.)
  // that breaks Markdown V1 entity parsing.
  await ctx.reply(
    "🔄 Running migrateSqliteToLance({ dryRun: true }) in an isolated tmpdir (does NOT touch your bot's real memory).",
  );

  const { migrateSqliteToLance } = await import("@usetheo/sdk");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // EC-7: mkdtempSync may fail (ENOSPC, EACCES) on container/embedded
  // with read-only or full /tmp.
  let demoCwd: string;
  try {
    demoCwd = mkdtempSync(join(tmpdir(), "tg-migrate-demo-"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Could not create demo workspace in /tmp: ${msg}. Skipping demo.`);
    return;
  }

  mkdirSync(join(demoCwd, ".theokit", "memory"), { recursive: true });
  writeFileSync(
    join(demoCwd, ".theokit", "memory", "MEMORY.md"),
    "# Memory\n\n- Demo fact 1\n- Demo fact 2\n- Demo fact 3\n",
    "utf8",
  );

  const result = await migrateSqliteToLance({
    cwd: demoCwd,
    dryRun: true,
  });

  // Plain text — demoCwd contains "_" (tg-migrate-demo-...) and
  // theokit-migrate-memory has "_" too. Markdown V1 entity parsing chokes
  // on these. Plain text is the safe default for runtime-generated content.
  await ctx.reply(
    [
      "Migration dry-run result:",
      `• countSqlite: ${result.countSqlite}`,
      `• countLance: ${result.countLance}`,
      `• validated: ${result.validated ? "✅" : "❌"}`,
      `• committed: ${result.committed ? "yes" : "no (dry-run)"}`,
      "",
      "For real migration of your bot's memory:",
      "  pnpm exec theokit-migrate-memory --cwd .",
      "",
      `Demo workspace (will be GC'd): ${demoCwd}`,
    ].join("\n"),
  );
});

// ────────────────────── /memory_lance — LanceDB opt-in showcase (v1.2) ──────────────────────
//
// Pure documentation command: prints the opt-in config snippet + the typed
// error shape. Does NOT try to open Lance — that requires @lancedb/lancedb
// installed and live workspace state. See ADR D43/D56.
runner.command("memory_lance", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const { ConfigurationError } = await import("@usetheo/sdk");
  const sampleConfig = {
    memory: {
      enabled: true,
      namespace: "my-bot",
      userId: "user-123",
      scope: "user",
      index: {
        backend: "lance",
        embedding: { provider: "openai", model: "text-embedding-3-small" },
      },
    },
  };
  const sampleError = new ConfigurationError("Lance backend unavailable", {
    code: "lance_backend_unavailable",
  });
  // No parse_mode — content is JSON + error names with underscores and
  // backticks that Telegram Markdown V1 mis-parses (error 400 "can't parse
  // entities"). Plain text is safest for arbitrary content like this.
  await ctx.reply(
    [
      "LanceDB backend opt-in (v1.2 ADR D43)",
      "",
      'Set memory.index.backend: "lance" in Agent.create options. Default remains SQLite.',
      "",
      "Sample config:",
      JSON.stringify(sampleConfig, null, 2),
      "",
      "Without @lancedb/lancedb installed, the first memory_search call raises:",
      `ConfigurationError { code: "${sampleError.code}", isRetryable: ${sampleError.isRetryable} }`,
      "",
      "Install with: pnpm add @lancedb/lancedb",
      "",
      "See also: /migrate_memory for the SQLite-to-Lance migration demo.",
      "Standalone example: examples/memory-lance",
    ].join("\n"),
  );
});

// ────────────────────── /notion — OAuth MCP demo (v1.2) ──────────────────────
//
// Notion MCP via OAuth 2.1 PKCE (ADR D41). The browser flow CANNOT run
// inside a Telegram bot (ADR D54) — user runs `pnpm exec
// theokit-mcp-auth-notion --setup` ONCE outside the bot to populate the
// token cache; subsequent /notion calls use the cached access token.
runner.command("notion", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  if (process.env.NOTION_OAUTH_CLIENT_ID === undefined) {
    await ctx.reply(
      [
        "*Notion MCP not configured.*",
        "",
        "1. Create integration: https://www.notion.so/my-integrations",
        "2. Set `NOTION_OAUTH_CLIENT_ID` in `.env`",
        "3. Run OAuth flow ONCE outside Telegram (browser callback can't reach bot):",
        "   `pnpm exec theokit-mcp-auth-notion --setup`",
        "4. Restart the bot — token cache is shared.",
        "",
        "See ADR D41 + ADR D54.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  await ctx.replyWithChatAction("typing");
  const agent = await getAgent(ctx, opts);
  try {
    const run = await agent.send(
      "List the first 3 databases I have in Notion (via the notion MCP tools). One per line.",
    );
    const result = await run.wait();
    if (result.status === "finished" && result.result !== undefined) {
      await ctx.reply(`*Notion databases:*\n\n${result.result.slice(0, 3500)}`, {
        parse_mode: "Markdown",
      });
    } else {
      const errMsg = result.error?.message ?? "no result";
      const errCode = result.error?.code ?? "unknown";
      // EC-6: detect OAuth-related failures and explain that the bot can't
      // drive the browser flow.
      if (
        errCode === "oauth_timeout" ||
        errCode === "oauth_state_mismatch" ||
        /OAuth|browser/i.test(errMsg)
      ) {
        await ctx.reply(
          [
            "Token cache empty. OAuth browser flow cannot run inside a Telegram bot.",
            "",
            "Run ONCE on a machine with a browser:",
            "  `pnpm exec theokit-mcp-auth-notion --setup`",
            "",
            "After that, the token cache is shared and `/notion` works from the bot.",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
      } else {
        await ctx.reply(
          `(${result.status}) ${errMsg.slice(0, 400)}\n\n` +
            "If this is an auth error, refresh via `pnpm exec theokit-mcp-auth-notion --setup`.",
        );
      }
    }
  } finally {
    await agent.dispose();
  }
});

// ────────────────────── /stream — runtime toggle (v1.2) ──────────────────────
//
// Switches between "wait" (default v1.1 behavior) and "stream" (incremental
// editMessageText UX). Persists in memory only (D53).
runner.command("stream", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const arg = match.toLowerCase() ?? "";
  if (arg !== "on" && arg !== "off") {
    const current = getStreamMode();
    await ctx.reply(
      [
        `*Streaming mode:* \`${current}\``,
        "",
        "Usage:",
        "  `/stream on` — incremental editMessageText (UX: ChatGPT-like)",
        "  `/stream off` — final `run.wait()` reply (default, simpler error handling)",
        "",
        "Default at startup: env `STREAM_MODE=stream` else `wait`.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  setStreamMode(arg === "on" ? "stream" : "wait");
  const note =
    arg === "on"
      ? "\n\n_Note: inline buttons (`[BUTTONS: A | B]`) are NOT supported in stream mode (D58). Switch /stream off for button-based prompts._"
      : "";
  await ctx.reply(`Streaming mode now: \`${arg === "on" ? "stream" : "wait"}\`${note}`, {
    parse_mode: "Markdown",
  });
});

// ────────────────────── /personality <name> — Hermes #26, ADRs D160-D169 ──────────────────────
//
// `/personality` (no arg) lists available presets from `.theokit/personalities/`.
// `/personality <name>` activates the preset for the next send.
// `/personality none` (or `default`/`neutral`) clears the active preset.
// All switches persist per-user via `{ save: true }` so a restart preserves voice
// (D163 + EC-B: clear path DELETES the JSON key, never writes `null`).
// EC-G (input trim) — args are trimmed and lowercased to match the lowercase-only
// slug regex enforced by Zod (D161 + EC-C). EC-H (first-token only) — only the
// first whitespace-delimited token is honored; trailing args are ignored with
// a polite "did you mean: <slug>?" if no exact match exists.
runner.command("personality", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const raw = match;
  // EC-G + EC-H: trim, lowercase, take first whitespace-delimited token.
  const arg = raw.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";

  if (arg.length === 0) {
    // List available presets by reading the `.theokit/personalities/` dir
    // directly. Cheaper than spinning the registry just to enumerate names
    // (the registry is loaded lazily on the first `usePersonality` call).
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const presetDir = join(CWD, ".theokit", "personalities");
    let entries: string[] = [];
    try {
      entries = (await readdir(presetDir)).filter((f) => f.endsWith(".md"));
    } catch {
      entries = [];
    }
    if (entries.length === 0) {
      await ctx.reply(
        [
          "*No personalities loaded.*",
          "",
          "Drop a `.theokit/personalities/<name>.md` with YAML frontmatter:",
          "```",
          "---",
          "name: coder",
          "description: Concise, technical, code-first replies.",
          "---",
          "You are in coder mode. ...",
          "```",
          "",
          "Then `/personality coder` to activate.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }
    const lines: string[] = [];
    for (const file of entries) {
      const raw = await readFile(join(presetDir, file), "utf8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      const nameMatch = fm?.[1]?.match(/^name:\s*(.+)$/m);
      const descMatch = fm?.[1]?.match(/^description:\s*(.+)$/m);
      const name = nameMatch?.[1]?.trim() ?? file.replace(/\.md$/, "");
      const desc = descMatch?.[1]?.trim() ?? "(no description)";
      lines.push(`• *${name}* — ${desc}`);
    }
    await ctx.reply(
      [
        "*Available personalities*",
        "",
        ...lines,
        "",
        "`/personality <name>` — activate (persists per-user).",
        "`/personality none` — clear active preset.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }

  const agent = await getAgent(ctx, opts);
  try {
    if (agent.usePersonality === undefined) {
      await ctx.reply(
        "Personality presets require a local agent. This instance is cloud-only.",
      );
      return;
    }
    const result = await agent.usePersonality(arg, { save: true });
    if (result === null) {
      await ctx.reply("Personality cleared. Next reply uses the default voice.");
    } else {
      await ctx.reply(
        [
          `Activated *${result.name}*${result.description !== undefined ? ` — ${result.description}` : ""}.`,
          "",
          "Send any message to try it. `/personality none` to clear.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`\`${Security.redact(message)}\``, { parse_mode: "Markdown" });
  } finally {
    await agent.dispose();
  }
});

// ────────────────────── /skill <name> — drill-down skill content (ADR D57) ──────────────────────
//
// Reads .theokit/skills/<name>/SKILL.md directly from filesystem (instant,
// no LLM tokens). Sanitizes name via regex to prevent path traversal.
runner.command("skill", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const name = match;
  if (name.length === 0) {
    await ctx.reply(
      "Usage: `/skill <name>` — drills into `.theokit/skills/<name>/SKILL.md`. Run `/skills` first to list available skills.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  const content = await readSkillFile(CWD, name);
  if (content === undefined) {
    await ctx.reply(`Skill "${name}" not found in \`.theokit/skills/\`.`, {
      parse_mode: "Markdown",
    });
    return;
  }
  const truncated =
    content.length > 3500
      ? `${content.slice(0, 3500)}\n\n_(truncated; full at .theokit/skills/${name}/SKILL.md)_`
      : content;
  await ctx.reply(`*Skill: ${name}*\n\n\`\`\`\n${truncated}\n\`\`\``, {
    parse_mode: "Markdown",
  });
});

runner.command("summary", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  await ctx.reply("Running the nightly dreaming sweep on demand. This takes a few seconds...");
  try {
    const result = await runDreamNow(CWD);
    await ctx.reply(
      [
        `*Sweep status: ${result.status}*`,
        `• Facts: ${result.factsBefore} → ${result.factsAfter}`,
        `• Duplicates removed: ${result.duplicatesRemoved}`,
        `• Clusters: ${result.clustersCreated}`,
        `• Notes written: ${result.notesWritten}`,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Sweep failed: ${msg.slice(0, 400)}`);
  }
});

runner.command("cron", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const jobs = await listCronJobs();
  if (jobs.length === 0) {
    await ctx.reply("No cron jobs registered. The nightly dreaming sweep runs at 03:00 UTC by default.");
    return;
  }
  const lines = jobs.map((j) => {
    const next = j.nextRunAt !== undefined ? new Date(j.nextRunAt).toISOString().slice(0, 16).replace("T", " ") : "(unscheduled)";
    return `• \`${j.id.slice(0, 36)}\` — \`${j.cron}\` — next: ${next} (${j.enabled ? "on" : "off"})`;
  });
  await ctx.reply(`*Cron jobs (${jobs.length})*\n\n${lines.join("\n")}`, {
    parse_mode: "Markdown",
  });
});

runner.command("remind", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  // Usage: /remind <cron-5fields> | <message text>
  // Example: /remind 0 9 * * 1 | pay the credit card
  const raw = match;
  if (raw.length === 0 || !raw.includes("|")) {
    await ctx.reply(
      [
        "Usage:",
        "`/remind <cron-5fields> | <message>`",
        "",
        "Examples:",
        "• `/remind 0 9 * * 1 | drink water` (every Monday 9am)",
        "• `/remind 0 8 1 * * | pay the rent` (1st of month 8am)",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  const [cronExpr, ...messageParts] = raw.split("|");
  const cron = (cronExpr ?? "").trim();
  const message = messageParts.join("|").trim();
  if (cron.length === 0 || message.length === 0) {
    await ctx.reply("Both parts required — cron expression AND message, separated by `|`.");
    return;
  }
  try {
    const job = await scheduleReminder({
      cwd: CWD,
      apiKey: API_KEY,
      cron,
      message,
      userId: resolveUserId(ctx),
    });
    const next = job.nextRunAt !== undefined ? new Date(job.nextRunAt).toISOString() : "(unscheduled)";
    await ctx.reply(`Reminder scheduled: \`${job.id}\`\nNext fire: ${next}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    await ctx.reply(`Failed to schedule: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  }
});

runner.command("reset", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const agentId = resolveAgentId(ctx);
  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await rm(join(CWD, ".theokit", "agents", agentId), { recursive: true, force: true });
  const { Agent } = await import("@usetheo/sdk");
  try {
    await Agent.delete(agentId);
  } catch {}
  await ctx.reply("Thread cleared. Memory facts preserved — say /start in a moment.");
});

// ────────────────────── /tool — per-call SendOptions.tools demo ──────────────────────
//
// Each `/tool <name> <args>` injects ONE ad-hoc tool via `SendOptions.tools` —
// the LLM only sees that tool plus shell (the SDK's built-in). MCP, memory, and
// agent-level custom tools (e.g. current_time) are EXCLUDED for the call. This
// demonstrates per-call override (replace, not merge).
runner.command("tool", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const raw = match.trim();
  if (raw.length === 0 || raw === "list") {
    // Plain text — descriptions contain "_" (e.g., "Sao_Paulo") that breaks Markdown V1.
    await ctx.reply(
      [
        "Ad-hoc tools (injected per-call via SendOptions.tools):",
        "",
        listAdHocTools(),
        "",
        "Usage: /tool <name> <args> — e.g. /tool roll 3d6, /tool uuid, /tool hash sha256 hello.",
        "The model only sees the named tool — no shell magic, no MCP fallback.",
      ].join("\n"),
    );
    return;
  }
  const [toolName, ...rest] = raw.split(/\s+/);
  const argText = rest.join(" ").trim();
  if (toolName === undefined || !(toolName in AD_HOC_TOOLS)) {
    await ctx.reply(
      `Unknown tool "${toolName ?? ""}". Try /tool list to see what's available.`,
    );
    return;
  }
  const tool = AD_HOC_TOOLS[toolName];
  if (tool === undefined) return; // satisfies strict mode

  const agent = await getAgent(ctx, opts);
  try {
    await ctx.replyWithChatAction("typing");
    const userMessage = [
      `User invoked /tool ${toolName} with arguments: "${argText.length > 0 ? argText : "(none)"}"`,
      "",
      "Call the available tool with appropriately-parsed arguments and report the result.",
      'Format: short markdown reply that includes the literal result. Do not invent fields.',
    ].join("\n");
    const run = await agent.send(userMessage, {
      // Per-call override: ONLY this tool is registered with the LLM for this run.
      // No memory tools, no MCP, no agent-level current_time. The model has to
      // use exactly this tool (or refuse). This is the SendOptions.tools
      // contract from SDK v1.x: replace, not merge.
      tools: [tool],
      // Pin gpt-4o-mini: single-tool ad-hoc calls are tool-calling-only; gpt-
      // 4o-mini has strict tool-call compliance and lives on a different
      // OpenRouter rate-limit bucket than Gemini (the agent's default model).
      model: { id: "openai/gpt-4o-mini" },
      systemPrompt: SYSTEM_PROMPT,
    });
    const result = await run.wait();
    if (result.status !== "finished" || result.result === undefined) {
      await ctx.reply(
        `(run ${result.status}) ${result.error?.message ?? "no result"}`.slice(0, 1000),
      );
      return;
    }
    // LLM output is arbitrary — underscores in JSON keys, tool IDs, etc. would
    // break Markdown V1 parsing. Send as plain text.
    await ctx.reply(result.result);
  } finally {
    await agent.dispose();
  }
});

// ────────────────────── /goal — Agent.runUntil(goal) showcase ──────────────────────
//
// Drives the Ralph loop primitive shipped in the SDK background-work block
// (ADRs D110-D122). The bot:
//   1. Creates a transient agent (kept short to fit Telegram's rate limit)
//   2. Calls `agent.runUntil(goal, { maxTurns: 3, judgeModel: "openai/gpt-4o-mini" })`
//   3. Streams the discriminated `GoalEvent` updates back to the chat
//   4. Disposes the agent at end
//
// Real-LLM only — OPENROUTER_API_KEY required (the judge auxiliary agent
// reads it directly per ADR D119, EC-A).
runner.command("goal", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const goal = match.trim();
  if (goal.length === 0) {
    await ctx.reply(
      [
        "Usage: /goal <goal description>",
        "",
        "Example: /goal write a haiku about robots and stop when done",
        "",
        "Drives Agent.runUntil(goal) with a judge model (openai/gpt-4o-mini).",
        "Max 3 turns. Real-LLM only.",
      ].join("\n"),
    );
    return;
  }
  const { Agent } = await import("@usetheo/sdk");
  // Honor TELEGRAM_PRO_MODEL so /goal works in local Ollama mode.
  const goalModelId = process.env.TELEGRAM_PRO_MODEL ?? "openai/gpt-4o-mini";
  const agent = await Agent.create({
    apiKey: API_KEY,
    local: { cwd: CWD },
    systemPrompt: "You are a concise assistant. Respond briefly. Stop when the user's goal is satisfied.",
    model: { id: goalModelId },
  });
  try {
    await ctx.replyWithChatAction("typing");
    if (agent.runUntil === undefined) {
      await ctx.reply("Agent.runUntil is not available on this agent runtime.");
      return;
    }
    const summary: string[] = [`Goal: ${goal}`];
    let turnsSeen = 0;
    for await (const event of agent.runUntil(goal, {
      maxTurns: 3,
      judgeModel: "openai/gpt-4o-mini",
    })) {
      if (event.type === "turn_start") {
        turnsSeen = event.turn;
        summary.push(`— turn ${event.turn} starting…`);
      } else if (event.type === "judge_verdict") {
        summary.push(`— turn ${event.turn} verdict: ${event.verdict} (${event.reason.slice(0, 60)})`);
      } else if (event.type === "status_change") {
        summary.push(`Status: ${event.status} — ${event.reason}`);
      }
    }
    summary.push("", `(${turnsSeen} turn${turnsSeen === 1 ? "" : "s"} used; via Agent.runUntil)`);
    await ctx.reply(summary.join("\n").slice(0, 3500));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`(/goal error) ${msg.slice(0, 500)}`);
  } finally {
    await agent.dispose();
  }
});

// ────────────────────── /pool — Credential Pool showcase (v1.10) ──────────────────────
//
// Demonstrates the v1.10 credential-pool primitive (ADRs D123-D133). Three
// modes:
//   /pool          — status of all configured pools (entry count, strategy,
//                    health). Config-only, no LLM call.
//   /pool status   — alias for /pool.
//   /pool stress   — sends 5 rapid LLM calls to provoke a 429 from the
//                    OpenRouter free-tier rate limiter; the bot reports
//                    each call's outcome (entry used, status) so rotation
//                    is observable in real time.
//
// The pool is wired implicitly via `apiKeys`: if your `.env` has
// OPENROUTER_API_KEY_1 + OPENROUTER_API_KEY_2 set, the agent registers
// them as a 2-entry pool. Otherwise the single OPENROUTER_API_KEY single-key
// path is used (no rotation observable — documents the upgrade path).
runner.command("pool", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const arg = match.trim().toLowerCase();
  if (arg === "" || arg === "status") {
    const lines = [
      "Credential Pool status (v1.10, ADRs D123-D133):",
      "",
      "Config:",
      `  apiKey (single-key shape): ${API_KEY === undefined ? "(unset)" : "✓ configured"}`,
      `  apiKeys (pool shape):      check .env for OPENROUTER_API_KEY_2/3/...`,
      "",
      "Storage:  ~/.theokit/credential-pool.json (lazy load)",
      "Strategy: fill_first (default — burn key #1 first, rotate on exhaust)",
      "",
      "Try /pool stress to provoke a 429 and watch rotation.",
    ].join("\n");
    await ctx.reply(lines);
    return;
  }
  if (arg !== "stress") {
    await ctx.reply("Usage: /pool [status|stress]");
    return;
  }

  // Stress test — 5 rapid LLM calls. With 1-key pool, this typically
  // surfaces 429 on call 3-4 (OpenRouter free tier ~10 RPM). The
  // PoolAwareLlmClient transparently retries the same key once (D126)
  // before rotating. With a 2-key pool configured via OPENROUTER_API_KEY_2,
  // the rotation is observable.
  const { Agent } = await import("@usetheo/sdk");
  const agent = await Agent.create({
    apiKey: API_KEY,
    local: { cwd: CWD },
    systemPrompt: "Reply with exactly one word.",
    model: { id: "openai/gpt-4o-mini" },
  });
  try {
    const results: string[] = ["Pool stress — 5 rapid LLM calls:"];
    for (let i = 1; i <= 5; i += 1) {
      const t0 = Date.now();
      try {
        const run = await agent.send(`Pick a fruit (call ${i})`);
        const result = await run.wait();
        const dt = Date.now() - t0;
        const reply = (result.result ?? "").slice(0, 30);
        results.push(`  ${i}. ✓ ${dt}ms — ${reply}`);
      } catch (err) {
        const dt = Date.now() - t0;
        const msg = err instanceof Error ? err.message.slice(0, 60) : String(err);
        results.push(`  ${i}. ✗ ${dt}ms — ${msg}`);
      }
    }
    results.push("");
    results.push("(With 2+ keys in apiKeys, errors above would auto-rotate)");
    await ctx.reply(results.join("\n"));
  } finally {
    await agent.dispose();
  }
});

// ────────────────────── /loop family ──────────────────────

/**
 * Drive the per-chat agent for a loop fire. Mirrors dispatchToAgent but
 * (a) takes a plain chatId instead of grammy Context (no ctx exists on a
 * scheduled fire) and (b) returns the reply text instead of replying. The
 * loop module is responsible for sending the result to Telegram.
 */
async function fireForLoop(prompt: string, chatId: number): Promise<string> {
  const { Agent, UnknownAgentError } = await import("@usetheo/sdk");
  const agentId = `tg-pro-dm-${chatId}`;
  let agent: Awaited<ReturnType<typeof Agent.create>>;
  try {
    agent = await Agent.resume(agentId, {
      apiKey: API_KEY,
      local: { cwd: CWD },
    });
  } catch (err) {
    if (!(err instanceof UnknownAgentError)) throw err;
    // First-fire on a chat that hasn't /start-ed yet — create with minimal config.
    agent = await Agent.create({
      agentId,
      apiKey: API_KEY,
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: CWD, settingSources: ["project", "plugins"], sandboxOptions: { enabled: true } },
      memory: {
        enabled: true,
        namespace: "tg-pro",
        scope: "user",
        userId: String(chatId),
        activeRecall: { enabled: true, queryMode: "recent" },
      },
      systemPrompt: SYSTEM_PROMPT,
    });
  }
  try {
    const mcpServers = buildMcpServers(CWD);
    const run = await agent.send(prompt, {
      systemPrompt: SYSTEM_PROMPT,
      ...(mcpServers !== undefined ? { mcpServers } : {}),
    });
    const result = await run.wait();
    if (result.status === "finished" && result.result !== undefined) return result.result;
    return `(run ${result.status}) ${result.error?.message ?? ""}`.trim();
  } finally {
    await agent.dispose();
  }
}

// ────────────────────── /handoff_demo — Agent handoff showcase (v1.16) ──────────────────────
//
// Demonstrates Adoption Roadmap #4 (ADRs D214-D229): a triage agent that
// routes to one of two specialists (billing OR support) based on intent.
// Each specialist replies; the triage's response carries that reply back.
runner.command("handoff_demo", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const question = match.trim();
  if (question.length === 0) {
    await ctx.reply(
      [
        "Usage: /handoff_demo <question>",
        "",
        "Examples:",
        "  /handoff_demo I was charged twice this month",
        "  /handoff_demo How do I install the SDK?",
        "",
        "Triage routes to billing OR support based on intent (D214-D229).",
      ].join("\n"),
    );
    return;
  }
  await ctx.replyWithChatAction("typing");

  const { Agent, Handoff, RECOMMENDED_HANDOFF_PROMPT_PREFIX } = await import("@usetheo/sdk");

  // Build 3 throwaway agents for this demo (disposed at end). Sharing the
  // bot's main agent factory would mix telegram-pro's history with this
  // demo's; isolate to keep the demo predictable.
  const baseConfig = {
    apiKey: API_KEY,
    model: { id: process.env.TELEGRAM_PRO_MODEL ?? "google/gemini-2.0-flash-001" },
    local: { cwd: CWD, sandboxOptions: { enabled: false } as const },
  };

  let triage: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let billing: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let support: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    billing = await Agent.create({
      ...baseConfig,
      name: "billing",
      systemPrompt:
        "You are a billing specialist. Answer concisely about invoices, charges, payments.",
    });
    support = await Agent.create({
      ...baseConfig,
      name: "support",
      systemPrompt:
        "You are a technical support specialist. Answer concisely about installation, configuration, troubleshooting.",
    });
    triage = await Agent.create({
      ...baseConfig,
      name: "triage",
      systemPrompt: `${RECOMMENDED_HANDOFF_PROMPT_PREFIX}

You are a triage agent. Listen to the user's question and IMMEDIATELY
transfer to the right specialist using exactly ONE transfer_to_* tool:
  - billing / payment / invoice questions → transfer_to_billing
  - install / config / how-to questions   → transfer_to_support

Do NOT answer the user directly.`,
      handoffs: [
        billing,
        Handoff.create(support, {
          toolDescription: "Transfer to support for install/config/troubleshoot issues.",
        }),
      ],
    });

    const run = await triage.send(question);
    const result = await run.wait();
    const reply =
      result.status === "finished" && result.result !== undefined
        ? result.result
        : `(triage run ${result.status}${result.error ? `: ${result.error.message}` : ""})`;
    await ctx.reply(
      [
        `Handoff demo (D214-D229):`,
        ``,
        reply.slice(0, 3500),
      ].join("\n"),
    );
  } catch (err) {
    await ctx.reply(`/handoff_demo error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (triage !== undefined) await triage.dispose();
    if (billing !== undefined) await billing.dispose();
    if (support !== undefined) await support.dispose();
  }
});

// ────────────────────── /workflow_demo — Declarative pipeline showcase (v1.17) ──────────────────────
//
// Demonstrates Adoption Roadmap #5 (ADRs D230-D248): declarative
// multi-step pipeline. validate → classify (LLM) → branch (billing/support)
// → resolve, with `WorkflowRun.stepResults` showing per-step breakdown.
runner.command("workflow_demo", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const claim = match.trim();
  if (claim.length === 0) {
    await ctx.reply(
      [
        "Usage: /workflow_demo <claim>",
        "",
        "Examples:",
        "  /workflow_demo I was charged twice this month",
        "  /workflow_demo How do I install the SDK on Windows?",
        "",
        "Runs a 4-step declarative pipeline (D230-D248):",
        "  validate -> classify (LLM) -> branch (billing/support) -> resolve",
      ].join("\n"),
    );
    return;
  }
  await ctx.replyWithChatAction("typing");

  const { Agent, Workflow, fn, agentStep } = await import("@usetheo/sdk");

  const baseConfig = {
    apiKey: API_KEY,
    model: { id: process.env.TELEGRAM_PRO_MODEL ?? "google/gemini-2.0-flash-001" },
    local: { cwd: CWD, sandboxOptions: { enabled: false } as const },
  };

  let classifier: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let billing: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let support: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    classifier = await Agent.create({
      ...baseConfig,
      name: "classifier",
      systemPrompt:
        "You classify customer support requests. Reply with EXACTLY one word: BILLING, SUPPORT, or OTHER.",
    });
    billing = await Agent.create({
      ...baseConfig,
      name: "billing",
      systemPrompt:
        "You are a billing specialist. Answer concisely (1-2 sentences).",
    });
    support = await Agent.create({
      ...baseConfig,
      name: "support",
      systemPrompt:
        "You are a technical support specialist. Answer concisely (1-2 sentences).",
    });

    const wf = Workflow.create<{ claim: string }, string>({ name: "tg-workflow-demo" })
      .then(
        fn<{ claim: string }, { claim: string; ts: number }>("validate", (input) => {
          if (!input.claim || input.claim.length < 3) {
            throw new Error("claim must be at least 3 characters");
          }
          return { ...input, ts: Date.now() };
        }),
      )
      .then(
        agentStep(
          "classify",
          classifier,
          (input) => `Classify: "${(input as { claim: string }).claim}"`,
        ),
      )
      .branch(
        [
          [
            (out) => String(out).toUpperCase().includes("BILLING"),
            [agentStep("billing_resolve", billing, "Handle the billing question.")],
          ],
          [
            (out) => String(out).toUpperCase().includes("SUPPORT"),
            [agentStep("support_resolve", support, "Handle the support question.")],
          ],
        ],
        {
          id: "decide",
          fallback: [fn("escalate", () => "Escalating to a human agent.")],
        },
      )
      .commit();

    const run = await wf.run({ claim });
    const stepLines = run.stepResults
      .map((sr) => `  [${sr.kind}] ${sr.stepId} -> ${sr.status} (${sr.durationMs}ms, ${sr.attempts} attempt)`)
      .join("\n");
    const finalOutput = run.status === "completed" ? String(run.output ?? "(empty)") : (run.error?.message ?? run.status);
    await ctx.reply(
      [
        `Workflow demo (D230-D248):`,
        `Status: ${run.status}`,
        `Steps:`,
        stepLines,
        ``,
        `Final: ${finalOutput.slice(0, 2500)}`,
      ].join("\n"),
    );
  } catch (err) {
    await ctx.reply(`/workflow_demo error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (classifier !== undefined) await classifier.dispose();
    if (billing !== undefined) await billing.dispose();
    if (support !== undefined) await support.dispose();
  }
});

// ────────────────────── /cache_demo — Semantic cache showcase (v1.18) ──────────────────────
//
// Demonstrates Adoption Roadmap #6 (ADRs D249-D266): semantic cache via
// `Cache.semantic + cache.consult/remember`. First query misses (LLM call);
// a paraphrased second query hits the semantic layer (no LLM call); a
// third "weather" query is bypassed by the exclude regex.
runner.command("cache_demo", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const question = match.trim();
  if (question.length === 0) {
    await ctx.reply(
      [
        "Usage: /cache_demo <question>",
        "",
        "Runs the SAME question twice + a paraphrase + a weather query to",
        "exercise semantic cache (D249-D266). Stats printed at the end.",
      ].join("\n"),
    );
    return;
  }
  await ctx.replyWithChatAction("typing");

  const { Agent, Cache } = await import("@usetheo/sdk");

  const toyEmbedder = {
    id: "toy-letter",
    model: "letter-bag-1",
    dimension: 26,
    async embed(texts: ReadonlyArray<string>): Promise<number[][]> {
      return texts.map((t) => {
        const v = new Array(26).fill(0);
        const norm = t.toLowerCase().replace(/[^a-z]/g, "");
        for (const ch of norm) {
          const i = ch.charCodeAt(0) - 97;
          if (i >= 0 && i < 26) v[i] += 1;
        }
        const sum = v.reduce((a: number, b: number) => a + b, 0) || 1;
        return v.map((x: number) => x / sum);
      });
    },
  };

  const cache = Cache.semantic({
    embedder: toyEmbedder,
    threshold: 0.4,
    ttl: { default: "1h", exclude: /\b(weather|today|now|current|stock)\b/i },
    namespace: "tg-cache-demo",
    modelId: process.env.TELEGRAM_PRO_MODEL ?? "google/gemini-2.0-flash-001",
  });

  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    agent = await Agent.create({
      apiKey: API_KEY,
      model: { id: process.env.TELEGRAM_PRO_MODEL ?? "google/gemini-2.0-flash-001" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } as const },
      name: "cache-demo-agent",
    });

    const lines: string[] = [];

    // Pass 1: miss (cold)
    const m1 = await cache.consult(question);
    if (m1.hit) {
      lines.push("Pass 1: unexpected HIT (cache pre-populated?)");
    } else {
      const r1 = await agent.send(`${question} Answer in one short sentence.`);
      const res1 = await r1.wait();
      const text = res1.status === "finished" ? res1.result ?? "" : "(no answer)";
      await cache.remember(question, text);
      lines.push(`Pass 1: MISS → LLM → stored (${text.length} chars)`);
    }

    // Pass 2: paraphrase (expect semantic hit due to letter-bag similarity)
    const paraphrase = `Could you tell me: ${question}`;
    const m2 = await cache.consult(paraphrase);
    if (m2.hit) {
      lines.push(`Pass 2: HIT (${m2.source}${m2.distance !== undefined ? `, dist=${m2.distance.toFixed(3)}` : ""})`);
    } else {
      lines.push("Pass 2: miss (paraphrase too different for letter-bag embedder)");
    }

    // Pass 3: exclude regex bypass
    const m3 = await cache.consult("What's the weather in SF right now?");
    lines.push(`Pass 3 (weather query): hit=${m3.hit} — bypassed by exclude regex`);

    const s = cache.stats();
    const statsLine = `kvHits=${s.kvHits} semanticHits=${s.semanticHits} misses=${s.misses} excluded=${s.excluded} entries=${s.entries}`;
    lines.push("");
    lines.push(`Stats: ${statsLine}`);

    await ctx.reply(["Cache demo (D249-D266):", "", ...lines].join("\n"));
  } catch (err) {
    await ctx.reply(`/cache_demo error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (agent !== undefined) await agent.dispose();
  }
});

runner.command("loop", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const raw = match;
  const parts = raw.split(/\s+/);
  const duration = parts[0] ?? "";
  const prompt = parts.slice(1).join(" ");
  if (duration.length === 0 || prompt.length === 0) {
    // Plain text — "/stop_loop" contains "_" that breaks unbalanced Markdown italic.
    await ctx.reply(
      [
        "Usage: /loop <30s|2m|1h> <prompt>",
        "",
        "Examples:",
        "• /loop 30s diga oi",
        "• /loop 2m faça um resumo do que conversamos",
        "• /loop 1h pergunte como estou",
        "",
        "Mínimo 10s, máximo 24h. Use /loops pra listar, /stop_loop pra parar.",
      ].join("\n"),
    );
    return;
  }
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await ctx.reply("Loop requer um chat (não consegui resolver chat.id).");
    return;
  }
  const result = scheduleLoop({
    chatId,
    duration,
    prompt,
    bot,
    factoryOpts: opts,
    fire: fireForLoop,
  });
  if (!result.ok) {
    await ctx.reply(`❌ ${result.reason}`);
    return;
  }
  const nextFire = new Date(Date.now() + result.record.durationMs).toISOString().slice(11, 19);
  // Plain text — record.id contains "_" (e.g., "loop_30s_..."), and arbitrary prompt
  // may contain "_*[]" chars that break Markdown V1.
  await ctx.reply(
    [
      `🔁 Loop ${result.record.id} agendado.`,
      `Duração: cada ${duration}`,
      `Próxima execução: ${nextFire} UTC`,
      `Prompt: ${prompt.slice(0, 200)}`,
      "",
      `Pra parar: /stop_loop ${result.record.id}`,
    ].join("\n"),
  );
});

runner.command("loops", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const list = listLoops(chatId);
  if (list.length === 0) {
    await ctx.reply("Sem loops ativos. Crie um com /loop 30s diga oi");
    return;
  }
  const lines = list.map((r) => {
    const sec = Math.round(r.durationMs / 1000);
    return `• ${r.id} — cada ${sec}s — fires: ${r.fireCount} — ${r.prompt.slice(0, 60)}`;
  });
  // Plain text — IDs and prompts contain arbitrary chars.
  await ctx.reply(`Loops ativos (${list.length})\n\n${lines.join("\n")}`);
});

runner.command("stop_loop", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const arg = match;
  if (arg.length === 0) {
    // Plain text — "/stop_loop" contains "_".
    await ctx.reply("Usage: /stop_loop <id> ou /stop_loop all");
    return;
  }
  if (arg === "all") {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const n = stopAllLoopsForChat(chatId);
    await ctx.reply(`🛑 Parados: ${n} loop(s).`);
    return;
  }
  const stopped = stopLoop(arg);
  if (stopped === undefined) {
    await ctx.reply(`Loop "${arg}" não encontrado.`);
    return;
  }
  // Plain text — stopped.id contains "_".
  await ctx.reply(`🛑 Loop ${stopped.id} parado após ${stopped.fireCount} fires.`);
});

// ────────────────────── unified reply pipeline ──────────────────────

async function dispatchToAgent(ctx: Context, userText: string): Promise<void> {
  const agent = await getAgent(ctx, opts);
  try {
    // Per-send mcpServers override — SDK v1 persists most config (including
    // `context`, `providers`, `agents`) but mcpServers stay caller-supplied
    // because they may carry headers/env secrets stripped from the registry.
    const mcpServers = buildMcpServers(CWD);
    const sendOptions = {
      systemPrompt: SYSTEM_PROMPT,
      ...(mcpServers !== undefined ? { mcpServers } : {}),
    };

    // ADR D53: when /stream on, route through streamIntoTelegram for incremental
    // editMessageText UX. Default "wait" mode preserves v1.1 behavior exactly.
    // Stream mode does NOT support inline buttons (D58) — user has been warned
    // via /stream on reply.
    if (getStreamMode() === "stream") {
      await streamIntoTelegram(ctx, agent, userText, sendOptions);
      return;
    }

    const run = await agent.send(userText, sendOptions);
    const result = await run.wait();
    console.log(
      `[bot] result status=${result.status} runId=${result.id} resultLen=${(result.result ?? "").length}${result.error !== undefined ? ` errorCode=${result.error.code ?? "?"}` : ""}`,
    );
    if (result.status !== "finished" || result.result === undefined) {
      // SDK v1.0.x surfaces structured `result.error` (message + code) on
      // failed runs — no more draining `run.stream()` just to find the cause.
      const errMsg = result.error?.message ?? "";
      const errCode = result.error?.code ?? "no-detail";
      console.error(`[bot] run failed (${result.status}/${errCode}): ${errMsg}`);
      // Silent failures (no error detail) are almost always OpenRouter
      // rate-limit (~10 req/min free tier) or transient network.
      if (errMsg.length === 0 && result.status === "error") {
        await ctx.reply(
          `⚠️ Run falhou sem evento (provavelmente *rate-limit* do OpenRouter — free tier ≈ 10 req/min).\nEspera 10-20 segundos e tenta de novo.`,
          { parse_mode: "Markdown" },
        );
      } else {
        await ctx.reply(
          `(run ${result.status})${errMsg.length > 0 ? `\n\nDetail: ${errMsg.slice(0, 400)} [${errCode}]` : " — the LLM call didn't complete."}`,
        );
      }
      return;
    }
    const { cleanText, keyboard } = extractButtons(result.result);
    const parts = splitForTelegram(cleanText);
    for (let i = 0; i < parts.length; i += 1) {
      const isLast = i === parts.length - 1;
      await ctx.reply(parts[i] ?? "", {
        ...(isLast && keyboard !== undefined ? { reply_markup: keyboard } : {}),
      });
    }
  } finally {
    await agent.dispose();
  }
}

// ────────────────────── voice handler ──────────────────────

async function handleVoice(ctx: Context): Promise<void> {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  await ctx.replyWithChatAction("typing");
  const voice = ctx.message?.voice;
  if (voice === undefined) return;
  let transcript: string;
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
    const audio = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const result = await transcribeAudio({ audio, filename: `voice.${voice.mime_type?.includes("ogg") ? "ogg" : "mp4"}` });
    transcript = result.text;
    console.log(
      `[voice] transcribed via ${result.provider} in ${result.durationMs}ms: ${Security.redact(transcript).slice(0, 100)}`,
    );
  } catch (err) {
    if (err instanceof NoTranscriberError) {
      await ctx.reply(
        "Voice messages need a Whisper provider. Add `OPENAI_API_KEY` or `GROQ_API_KEY` to .env and restart.",
      );
      return;
    }
    console.error(`[voice] transcription failed:`, err);
    await ctx.reply(`Couldn't transcribe that voice message: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return;
  }
  await dispatchToAgent(ctx, `[voice transcript: ${transcript}]`);
}

// ────────────────────── photo + sticker handlers ──────────────────────

async function handleVisual(ctx: Context, fileId: string, cacheKey: string, kind: "photo" | "sticker"): Promise<void> {
  await ctx.replyWithChatAction("typing");
  let description: string;
  try {
    const file = await ctx.api.getFile(fileId);
    if (file.file_path === undefined) {
      await ctx.reply(`(no file_path returned for ${kind})`);
      return;
    }
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
    const image = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const mime = file.file_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const result = await describeImage({ image, mime, cacheKey, cwd: CWD });
    description = result.description;
    console.log(
      `[${kind}] described (cached=${result.cached}) in ${result.durationMs}ms: ${Security.redact(description).slice(0, 100)}`,
    );
  } catch (err) {
    console.error(`[${kind}] vision failed:`, err);
    await ctx.reply(`Couldn't describe that ${kind}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return;
  }
  const caption = ctx.message?.caption?.trim() ?? "";
  const userText = caption.length > 0
    ? `[${kind} description: ${description}]\nUser caption: "${caption}"`
    : `[${kind} description: ${description}]`;
  await dispatchToAgent(ctx, userText);
}

async function handlePhoto(ctx: Context): Promise<void> {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  const photos = ctx.message?.photo;
  if (photos === undefined || photos.length === 0) return;
  // Telegram returns multiple thumbnail sizes — pick the largest.
  const largest = photos[photos.length - 1];
  if (largest === undefined) return;
  await handleVisual(ctx, largest.file_id, `photo-${largest.file_unique_id}`, "photo");
}

async function handleSticker(ctx: Context): Promise<void> {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  const sticker = ctx.message?.sticker;
  if (sticker === undefined) return;
  if (sticker.is_animated === true || sticker.is_video === true) {
    await ctx.reply("(Animated stickers aren't supported yet — the vision model needs a static frame.)");
    return;
  }
  await handleVisual(ctx, sticker.file_id, `sticker-${sticker.file_unique_id}`, "sticker");
}

// ────────────────────── inline button callback ──────────────────────

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!isAgentCallback(data)) {
    await ctx.answerCallbackQuery();
    return;
  }
  const choice = decodeCallback(data);
  await ctx.answerCallbackQuery(`Selected: ${choice}`);
  // Forward the choice to the agent as the next user turn so the
  // conversation continues naturally.
  await dispatchToAgent(ctx, `[user tapped button: ${choice}]`);
});

// ────────────────────── regular text ──────────────────────

async function handleText(ctx: Context): Promise<void> {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  const raw = ctx.message?.text;
  if (raw === undefined) return;
  if (raw.startsWith("/")) return;
  const cleaned = policy !== undefined ? stripBotMention(raw, policy.botUsername) : raw;
  if (cleaned.length === 0) {
    await ctx.reply("(Empty message after mention — say something!)");
    return;
  }
  await dispatchToAgent(ctx, cleaned);
}

// ────────────────────── error handling + startup ──────────────────────

bot.catch((err) => {
  const c = err.ctx;
  const e = err.error;
  console.error(`[bot.catch] chat=${c.chat?.id} user=${c.from?.id} error=${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof GrammyError) console.error("  Grammy:", e.description);
  else if (e instanceof HttpError) console.error("  HTTP:", e);
});

process.on("SIGINT", async () => {
  console.log("\nShutting down — your data is safe on disk.");
  await runner.stop();
  process.exit(0);
});

console.log("Theo Pro bot starting...");
console.log(`  workspace: ${CWD}`);
console.log(`  allowed-users: ${ALLOWED_USERS.size === 0 ? "(everyone)" : Array.from(ALLOWED_USERS).join(",")}`);
console.log(`  voice: ${process.env.OPENAI_API_KEY ? "openai whisper" : process.env.GROQ_API_KEY ? "groq whisper" : "(none — voice messages will be rejected)"}`);
console.log(`  vision: gemini-2.0-flash-001 via OpenRouter (cached at .theokit/cache/vision/)`);

// Pre-flight: write the shell-policy + seed workspace (skills, plugins,
// context, wiki) + register cron jobs before connecting to Telegram, so
// the very first agent.send sees the full project state.
try {
  await ensureHooksPolicy(CWD);
  console.log("  shell tool: enabled (sandbox=on, policy=.theokit/hooks/shell-policy.md)");
} catch (err) {
  console.warn("  shell tool: policy setup failed:", err instanceof Error ? err.message : String(err));
}
try {
  await seedWorkspace(CWD);
  console.log("  workspace seeded: skills, hooks/, context/, wiki/");
} catch (err) {
  console.warn("  workspace seed failed:", err instanceof Error ? err.message : String(err));
}
try {
  await initCron(CWD, API_KEY);
  console.log("  cron: scheduler started (nightly dreaming sweep at 03:00 UTC)");
} catch (err) {
  console.warn("  cron: init failed:", err instanceof Error ? err.message : String(err));
}

// ADR D182/D183: when TELEGRAM_PRO_MODEL points at a local Ollama runtime,
// pre-warm the model on boot so the FIRST agent.send doesn't pay 20-30s of
// model-load latency. Subsequent calls hit a hot model. Also bumps Ollama
// keep_alive to 24h so memory-recall queries (embed model swap) don't
// evict the chat model.
const localModelMatch = (process.env.TELEGRAM_PRO_MODEL ?? "").match(/^ollama\/(.+)$/);
if (localModelMatch !== null) {
  const modelName = localModelMatch[1] ?? "";
  const ollamaHost = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  try {
    const t = Date.now();
    const r = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        keep_alive: "24h",
        messages: [{ role: "user", content: "ok" }],
      }),
    });
    console.log(
      `  ollama: pre-warmed ${modelName} (${Date.now() - t}ms, keep_alive=24h, status=${r.status})`,
    );
  } catch (err) {
    console.warn(
      "  ollama: pre-warm failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
console.log();

// Export the configured bot for dogfood / harness scripts that import this
// module and inject synthetic Updates via `bot.handleUpdate(...)`. Long-polling
// is started only when this module is the entrypoint (executed directly), not
// when imported.
export { bot };
export function setPolicyForDogfood(p: PolicyContext): void {
  policy = p;
}

const importedAsModule = process.env.TELEGRAM_PRO_NO_POLL === "1";
if (!importedAsModule) {
  await runner.start();
  // Resolve bot identity AFTER connect for the group-policy.
  const me = await bot.api.getMe();
  policy = { botUsername: me.username, botId: me.id };
  console.log(`Connected as @${me.username} (id=${me.id}). Send /start to your bot.`);
}
// Keep the InputFile import referenced so TS doesn't tree-shake it; we'll
// use it when we extend the bot to send photos back.
void InputFile;
