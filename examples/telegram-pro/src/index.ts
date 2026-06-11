import { Security } from "@theokit/sdk";
// @theokit/gateway FULL migration (Phase 7, ADRs D170-D181).
// The runner orchestrates lifecycle + slash dispatch + hook chain.
// `adapter.getBot()` exposes grammy's Bot for non-portable events
// (callback_query, bot.catch).
import type { GatewayHook, MessageEvent } from "@theokit/gateway";
import { GatewayRunner } from "@theokit/gateway";
import {
  type PolicyContext,
  TelegramAdapter,
  shouldRespondInChat,
  splitForTelegram,
  stripBotMention,
} from "@theokit/gateway-telegram";
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
import { registerCommands } from "./commands.js";

/**
 * Theo Pro — multimodal Telegram bot built on @theokit/sdk 1.0.0.
 *
 * Reproduces the 5 highest-value patterns from peer-project's `extensions/telegram`:
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
// T6.1 (arch-review-fixes-2026-06-06, PV#1): the 30+ runner.command(...)
// registrations and their inline helpers were extracted to ./commands.ts
// to break the 2317 LOC god file. Behavior identical — same closures, same
// helper functions, same dispatch order. Wired via a deps-object that
// passes the top-level state historically captured by lexical scope.
registerCommands(runner, { bot, opts, adapter, CWD, API_KEY, dispatchToAgent });

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
console.log(`  vision: openai/gpt-4o-mini via OpenRouter (cached at .theokit/cache/vision/)`);

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
