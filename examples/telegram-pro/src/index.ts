import { Bot, type Context, GrammyError, HttpError, InputFile } from "grammy";

import { AD_HOC_TOOLS, listAdHocTools } from "./ad-hoc-tools.js";
import { SYSTEM_PROMPT, getAgent, resolveAgentId, resolveUserId } from "./agent.js";
import { decodeCallback, extractButtons, isAgentCallback } from "./buttons.js";
import {
  initCron,
  listCronJobs,
  runDreamNow,
  scheduleReminder,
} from "./cron-setup.js";
import { splitForTelegram } from "./format.js";
import { shouldRespondInChat, stripBotMention, type PolicyContext } from "./group-policy.js";
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

const bot = new Bot(TOKEN);
const opts = { apiKey: API_KEY, cwd: CWD };
let policy: PolicyContext | undefined; // initialized after bot.start()

bot.use(async (ctx, next) => {
  const userId = resolveUserId(ctx);
  const ts = new Date().toISOString();
  const text = ctx.update.message?.text ?? ctx.update.message?.caption ?? "(non-text)";
  console.log(`[${ts}] user=${userId} chat=${ctx.chat?.type ?? "?"} text=${text.slice(0, 80)}`);
  if (ALLOWED_USERS.size > 0 && !ALLOWED_USERS.has(userId)) {
    await ctx.reply(
      `Sorry — this bot is restricted. Your user id is \`${userId}\`.`,
      { parse_mode: "Markdown" },
    );
    return;
  }
  await next();
});

// ────────────────────── slash commands ──────────────────────

bot.command("start", async (ctx) => {
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

bot.command("help", async (ctx) => {
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
      "/skill <name> — drill into a specific skill's SKILL.md content",
      "/summary — run dreaming sweep (dedup + cluster facts)",
      "/cron — list scheduled jobs",
      "/remind <cron> | <msg> — schedule a recurring reminder (cron syntax)",
      "/loop <30s|2m|1h> <prompt> — recurring agent.send delivered to this chat",
      "/loops — list active loops",
      "/stop_loop <id> — stop one loop (or `/stop_loop all` to stop all)",
      "/tool <name> <args> — ad-hoc tool via per-call override (`/tool list` to see registry)",
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
    { parse_mode: "Markdown" },
  );
});

bot.command("me", async (ctx) => {
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

bot.command("recall", async (ctx) => {
  const query = ctx.match?.toString().trim() ?? "";
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

bot.command("wiki", async (ctx) => {
  const query = ctx.match?.toString().trim() ?? "";
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

bot.command("agents", async (ctx) => {
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

bot.command("skills", async (ctx) => {
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
bot.command("fact", async (ctx) => {
  const topic = ctx.match?.toString().trim() ?? "";
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

// ────────────────────── /factstream — Agent.streamObject showcase (v1.2) ──────────────────────
//
// Like /fact, but streams partials via Agent.streamObject<T> (ADR D39).
// Some providers (Gemini/Anthropic) batch tool_use output — partials may
// be zero; in that case only the final `complete` event arrives. The 500ms
// throttle on editMessageText keeps Telegram rate-limit happy (ADR D52).
bot.command("factstream", async (ctx) => {
  const topic = ctx.match?.toString().trim() ?? "";
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

    for await (const evt of Agent.streamObject({
      apiKey: API_KEY,
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      schema,
      systemPrompt:
        "Match schema exactly. Keep summary 2-3 sentences. year=null if unknown.",
      prompt: `Produce a fact card about: ${topic}`,
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
bot.command("migrate_memory", async (ctx) => {
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
bot.command("memory_lance", async (ctx) => {
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
bot.command("notion", async (ctx) => {
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
bot.command("stream", async (ctx) => {
  const arg = ctx.match?.toString().trim().toLowerCase() ?? "";
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

// ────────────────────── /skill <name> — drill-down skill content (ADR D57) ──────────────────────
//
// Reads .theokit/skills/<name>/SKILL.md directly from filesystem (instant,
// no LLM tokens). Sanitizes name via regex to prevent path traversal.
bot.command("skill", async (ctx) => {
  const name = ctx.match?.toString().trim() ?? "";
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

bot.command("summary", async (ctx) => {
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

bot.command("cron", async (ctx) => {
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

bot.command("remind", async (ctx) => {
  // Usage: /remind <cron-5fields> | <message text>
  // Example: /remind 0 9 * * 1 | pay the credit card
  const raw = ctx.match?.toString().trim() ?? "";
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

bot.command("reset", async (ctx) => {
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
bot.command("tool", async (ctx) => {
  const raw = (ctx.match ?? "").toString().trim();
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

bot.command("loop", async (ctx) => {
  const raw = ctx.match?.toString().trim() ?? "";
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

bot.command("loops", async (ctx) => {
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

bot.command("stop_loop", async (ctx) => {
  const arg = ctx.match?.toString().trim() ?? "";
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

bot.on("message:voice", async (ctx) => {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  await ctx.replyWithChatAction("typing");
  const voice = ctx.message.voice;
  if (voice === undefined) return;
  let transcript: string;
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
    const audio = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const result = await transcribeAudio({ audio, filename: `voice.${voice.mime_type?.includes("ogg") ? "ogg" : "mp4"}` });
    transcript = result.text;
    console.log(`[voice] transcribed via ${result.provider} in ${result.durationMs}ms: ${transcript.slice(0, 100)}`);
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
});

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
    console.log(`[${kind}] described (cached=${result.cached}) in ${result.durationMs}ms: ${description.slice(0, 100)}`);
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

bot.on("message:photo", async (ctx) => {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  const photos = ctx.message.photo;
  if (photos === undefined || photos.length === 0) return;
  // Telegram returns multiple thumbnail sizes — pick the largest.
  const largest = photos[photos.length - 1];
  if (largest === undefined) return;
  await handleVisual(ctx, largest.file_id, `photo-${largest.file_unique_id}`, "photo");
});

bot.on("message:sticker", async (ctx) => {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  const sticker = ctx.message.sticker;
  if (sticker === undefined) return;
  if (sticker.is_animated === true || sticker.is_video === true) {
    await ctx.reply("(Animated stickers aren't supported yet — the vision model needs a static frame.)");
    return;
  }
  await handleVisual(ctx, sticker.file_id, `sticker-${sticker.file_unique_id}`, "sticker");
});

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

bot.on("message:text", async (ctx) => {
  if (policy !== undefined && !shouldRespondInChat(ctx, policy)) return;
  const raw = ctx.message.text;
  if (raw.startsWith("/")) return;
  const cleaned = policy !== undefined ? stripBotMention(raw, policy.botUsername) : raw;
  if (cleaned.length === 0) {
    await ctx.reply("(Empty message after mention — say something!)");
    return;
  }
  await dispatchToAgent(ctx, cleaned);
});

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
  await bot.stop();
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
  console.log("  shell tool: enabled (sandbox=on, policy=.theokit/hooks.json)");
} catch (err) {
  console.warn("  shell tool: policy setup failed:", err instanceof Error ? err.message : String(err));
}
try {
  await seedWorkspace(CWD);
  console.log("  workspace seeded: skills, plugins.json, context.json, wiki/");
} catch (err) {
  console.warn("  workspace seed failed:", err instanceof Error ? err.message : String(err));
}
try {
  await initCron(CWD, API_KEY);
  console.log("  cron: scheduler started (nightly dreaming sweep at 03:00 UTC)");
} catch (err) {
  console.warn("  cron: init failed:", err instanceof Error ? err.message : String(err));
}
console.log();

await bot.start({
  onStart: (me) => {
    policy = { botUsername: me.username, botId: me.id };
    console.log(`Connected as @${me.username} (id=${me.id}). Send /start to your bot.`);
  },
});
// Keep the InputFile import referenced so TS doesn't tree-shake it; we'll
// use it when we extend the bot to send photos back.
void InputFile;
