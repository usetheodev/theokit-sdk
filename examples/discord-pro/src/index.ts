/**
 * Theo Pro — multimodal Discord bot built on @usetheo/sdk via the
 * @usetheo/gateway abstraction.
 *
 * Same architecture as examples/telegram-pro post full migration:
 *  - `TelegramAdapter` → `DiscordAdapter` (only the transport changes).
 *  - `GatewayRunner` is the lifecycle owner.
 *  - `runner.command(name, h)` for slash dispatch (text-trigger `!cmd`).
 *  - `defaultHandler` routes media (photo attachments) + free text.
 *  - `allowlistRedactHook` is the `pre_inbound` filter.
 *
 * Discord-specific scope (vs telegram-pro's 28 commands):
 *  - 10 high-value commands: !start, !help, !me, !recall, !fact,
 *    !personality, !context, !memory, !cron, !summary
 *  - Free text → agent.send
 *  - Photo attachment → vision → agent
 *  - No voice (Discord has no voice-as-attachment), no stickers
 *  - No inline button keyboards (Discord uses Application Components,
 *    different API surface — out of scope for v0.1)
 */

import { Agent, type SDKAgent, Security } from "@usetheo/sdk";
import type { GatewayHook, MessageEvent } from "@usetheo/gateway";
import { GatewayRunner } from "@usetheo/gateway";
import { DiscordAdapter } from "@usetheo/gateway-discord";
import type { Message } from "discord.js";

// Narrow channel to one that has .send + .sendTyping. PartialGroupDMChannel
// (a discord.js union member) lacks both — but it's also a channel a bot
// can never receive messages from, so we can safely assert away.
type Sendable = {
  send: (content: string) => Promise<Message>;
  sendTyping: () => Promise<void>;
};
function sendable(msg: Message): Sendable {
  return msg.channel as unknown as Sendable;
}
import { z } from "zod";

import { SYSTEM_PROMPT, getAgent, resolveAgentId, resolveUserId } from "./agent.js";
import { splitForDiscord } from "./format.js";
import { listFacts } from "./memory-store.js";
import { buildMcpServers } from "./sdk-config.js";
import { describeImage } from "./vision.js";
import { searchWiki } from "./wiki-search.js";
import { ensureHooksPolicy } from "./hooks-setup.js";
import { seedWorkspace } from "./workspace-seeds.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (TOKEN === undefined || TOKEN.length === 0) {
  console.error("Missing DISCORD_BOT_TOKEN. See .env.example.");
  process.exit(1);
}
const API_KEY = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
if (API_KEY === undefined || API_KEY.length === 0) {
  console.error("Missing THEOKIT_API_KEY / OPENROUTER_API_KEY.");
  process.exit(1);
}
const CWD = process.cwd();

const ALLOWED_CHANNELS = new Set(
  (process.env.DISCORD_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

const adapter = new DiscordAdapter({ token: TOKEN });
const opts = { apiKey: API_KEY, cwd: CWD };

const allowlistRedactHook: GatewayHook = {
  name: "allowlist-redact",
  pre_inbound: ({ event }) => {
    if (event.platform !== "discord") return undefined;
    const ts = new Date().toISOString();
    const text = event.text.length > 0 ? event.text : "(non-text)";
    console.log(
      `[${ts}] user=${event.sender.id} chat=${event.channel.type} text=${Security.redact(text).slice(0, 80)}`,
    );
    if (ALLOWED_CHANNELS.size > 0 && !ALLOWED_CHANNELS.has(event.channel.id)) {
      // Silent ignore — Discord channels are public; we don't want to
      // reply with "you're not allowed" to every random channel the bot
      // happens to be in. Telegram is the opposite: per-DM gate.
      return { block: true };
    }
    return undefined;
  },
};

async function defaultHandler(event: MessageEvent): Promise<void> {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  if (msg.author.bot) return;

  // Photo attachments — describe via vision, then forward to agent.
  const photoAttachment = msg.attachments.find((a) =>
    a.contentType?.startsWith("image/"),
  );
  if (photoAttachment !== undefined) {
    return handlePhoto(msg, photoAttachment.url, photoAttachment.id);
  }

  // Plain text that isn't a `!command`.
  const text = event.text.trim();
  if (text.length === 0) return;
  if (text.startsWith("!")) return; // unmatched commands handled below

  return dispatchToAgent(msg, text);
}

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: defaultHandler,
  hooks: [allowlistRedactHook],
  // Discord text-trigger uses `!cmd` (e.g., `!help`). Telegram-default `/`
  // would never match here. Gateway core takes an array; pass both if
  // you want a bot that accepts `/help` AND `!help` simultaneously.
  commandPrefixes: ["!"],
});

// ────────────────────── shared dispatch helper ──────────────────────

async function dispatchToAgent(msg: Message, userText: string): Promise<void> {
  await sendable(msg).sendTyping().catch(() => undefined);
  const agent = await getAgent(msg, opts);
  try {
    const mcpServers = buildMcpServers(CWD);
    const sendOptions = {
      systemPrompt: SYSTEM_PROMPT,
      ...(mcpServers !== undefined ? { mcpServers } : {}),
    };
    const run = await agent.send(userText, sendOptions);
    const result = await run.wait();
    console.log(
      `[bot] result status=${result.status} runId=${result.id} resultLen=${(result.result ?? "").length}${result.error !== undefined ? ` errorCode=${result.error.code ?? "?"}` : ""}`,
    );
    if (result.status !== "finished" || result.result === undefined) {
      const errMsg = result.error?.message ?? "";
      const errCode = result.error?.code ?? "no-detail";
      if (errMsg.length === 0 && result.status === "error") {
        await msg.reply(
          "⚠️ Run failed silently (likely OpenRouter rate-limit on free tier — ~10 req/min). Retry in 10-20s.",
        );
      } else {
        await msg.reply(
          `(run ${result.status})${errMsg.length > 0 ? `\n\nDetail: ${errMsg.slice(0, 400)} [${errCode}]` : " — the LLM call didn't complete."}`,
        );
      }
      return;
    }
    const parts = splitForDiscord(result.result);
    for (const part of parts) {
      await sendable(msg).send(part);
    }
  } finally {
    await agent.dispose();
  }
}

// ────────────────────── photo handler ──────────────────────

async function handlePhoto(msg: Message, url: string, cacheKey: string): Promise<void> {
  await sendable(msg).sendTyping().catch(() => undefined);
  let description: string;
  try {
    const image = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const mime = url.endsWith(".webp")
      ? "image/webp"
      : url.endsWith(".png")
        ? "image/png"
        : "image/jpeg";
    const result = await describeImage({
      image,
      mime,
      cacheKey: `discord-${cacheKey}`,
      cwd: CWD,
    });
    description = result.description;
    console.log(
      `[photo] described (cached=${result.cached}) in ${result.durationMs}ms: ${Security.redact(description).slice(0, 100)}`,
    );
  } catch (err) {
    console.error("[photo] vision failed:", err);
    await msg.reply(
      `Couldn't describe that image: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    );
    return;
  }
  const caption = msg.content.trim();
  const userText =
    caption.length > 0
      ? `[photo description: ${description}]\nUser caption: "${caption}"`
      : `[photo description: ${description}]`;
  await dispatchToAgent(msg, userText);
}

// ────────────────────── slash commands ──────────────────────

runner.command("start", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  await msg.reply(
    [
      "**Welcome to Theo Pro — Discord edition.**",
      "",
      "**What I understand:**",
      "• Text — natural chat with memory + recall",
      "• Image attachments — I describe them via vision",
      "",
      `Your user id: \`${resolveUserId(msg)}\`. Agent id: \`${resolveAgentId(msg)}\`.`,
      "",
      "Send `!help` for commands.",
    ].join("\n"),
  );
});

runner.command("help", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  await msg.reply(
    [
      "**Theo Pro — commands**",
      "`!start`, `!help` — basics",
      "`!me` — what I remember about you (MEMORY.md)",
      "`!recall <q>` — search past conversations",
      "`!wiki <q>` — search the wiki corpus",
      "`!fact <topic>` — structured fact card via Agent.generateObject",
      "`!personality [<name>|none]` — activate a preset from .theokit/personalities/",
      "`!context` — list discovered context files",
      "`!memory <provider> <topic>` — third-party memory (supermemory/honcho/mem0)",
      "`!cron` — list scheduled jobs",
      "`!summary` — run dreaming sweep (dedup + cluster facts)",
      "",
      "Just type freely to chat. Drop an image to have me describe it.",
    ].join("\n"),
  );
});

runner.command("me", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const facts = await listFacts(CWD);
  if (facts.length === 0) {
    await msg.reply(
      "I don't remember anything about you yet. Say `Remember: <fact>` and I'll persist it.",
    );
    return;
  }
  const lines = facts.map((f) => `${f.index}. ${f.text}`).join("\n");
  await msg.reply(`**What I remember about you**\n\n${lines}`);
});

runner.command("recall", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const query = event.text.replace(/^!\S+\s*/, "").trim();
  if (query.length === 0) {
    await msg.reply("Usage: `!recall jazz` — searches past conversations.");
    return;
  }
  await dispatchToAgent(
    msg,
    `Use memory_search with corpus="sessions" to find past conversations about: ${query}. List the top 3 matches with a one-line summary each. If nothing matches, say so.`,
  );
});

runner.command("wiki", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const query = event.text.replace(/^!\S+\s*/, "").trim();
  if (query.length === 0) {
    await msg.reply("Usage: `!wiki tools` — searches `.theokit/memory/wiki/*.md`.");
    return;
  }
  const hits = await searchWiki(CWD, query);
  if (hits.length === 0) {
    await msg.reply(`No wiki entry for "${query}".`);
    return;
  }
  for (const hit of hits.slice(0, 3)) {
    const body = `**${hit.filename}**\n\`\`\`\n${hit.excerpt.slice(0, 1800)}\n\`\`\``;
    await sendable(msg).send(body);
  }
  if (hits.length > 3) {
    await sendable(msg).send(`_(...${hits.length - 3} extra match(es) omitted.)_`);
  }
});

runner.command("fact", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const topic = event.text.replace(/^!\S+\s*/, "").trim();
  if (topic.length === 0) {
    await msg.reply(
      "**Usage:** `!fact <topic>` — returns a structured fact card via `Agent.generateObject<T>`.",
    );
    return;
  }
  await sendable(msg).sendTyping().catch(() => undefined);
  try {
    const schema = z.object({
      title: z.string().min(1).describe("Short title."),
      summary: z.string().min(20).describe("2-3 sentence summary."),
      year: z.number().int().nullable().describe("Year, or null."),
      sources: z.array(z.string()).min(1).max(3).describe("Up to 3 source descriptions."),
    });
    const t0 = Date.now();
    const out = await Agent.generateObject({
      apiKey: API_KEY,
      // Pinned to gpt-4o-mini: Gemini 2.0 Flash occasionally returns plain
      // text instead of calling the synthetic `output` tool, breaking
      // generateObject. gpt-4o-mini has reliable tool-call compliance.
      // Same pinning rationale as telegram-pro `/fact` (see skill notes).
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      schema,
      systemPrompt:
        "You produce a structured fact card. Match the schema exactly. Keep summary 2-3 sentences. Set year to null if unknown.",
      prompt: `Produce a fact card about: ${topic}`,
    });
    const elapsed = Date.now() - t0;
    const sources = out.object.sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const yearText = out.object.year === null ? "(n/a)" : String(out.object.year);
    await msg.reply(
      [
        `**${out.object.title}**`,
        "",
        out.object.summary,
        "",
        `Year: ${yearText}`,
        "Sources:",
        sources,
        "",
        `_(generated via Agent.generateObject in ${elapsed}ms)_`,
      ].join("\n"),
    );
  } catch (err) {
    await msg.reply(`Failed to generate fact: ${Security.redact(String(err)).slice(0, 200)}`);
  }
});

runner.command("personality", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const arg = event.text.replace(/^!\S+\s*/, "").trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";

  if (arg.length === 0) {
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
      await msg.reply(
        "**No personalities loaded.** Drop a `.theokit/personalities/<name>.md` with YAML frontmatter and restart.",
      );
      return;
    }
    const lines: string[] = [];
    for (const file of entries) {
      const raw = await readFile(join(presetDir, file), "utf8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      const name = fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, "");
      const desc =
        fm?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "(no description)";
      lines.push(`• **${name}** — ${desc}`);
    }
    await msg.reply(
      [
        "**Available personalities**",
        "",
        ...lines,
        "",
        "`!personality <name>` — activate (persists per-user).",
        "`!personality none` — clear active preset.",
      ].join("\n"),
    );
    return;
  }

  const agent: SDKAgent = await getAgent(msg, opts);
  try {
    if (agent.usePersonality === undefined) {
      await msg.reply("Personality presets require a local agent. This instance is cloud-only.");
      return;
    }
    const result = await agent.usePersonality(arg, { save: true });
    if (result === null) {
      await msg.reply("Personality cleared. Next reply uses the default voice.");
    } else {
      await msg.reply(
        `Activated **${result.name}**${result.description !== undefined ? ` — ${result.description}` : ""}.\n\nSend any message to try it. \`!personality none\` to clear.`,
      );
    }
  } catch (err) {
    await msg.reply(`\`${Security.redact(String(err)).slice(0, 200)}\``);
  } finally {
    await agent.dispose();
  }
});

runner.command("context", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const agent = await getAgent(msg, opts);
  try {
    const snap = await agent.context?.snapshot();
    if (snap === undefined) {
      await msg.reply("Context manager not enabled.");
      return;
    }
    const lines = snap.sources.map((s) => `• \`${s.name}\``);
    await msg.reply(
      `**Context files discovered (${snap.sources.length})**\n\n${lines.slice(0, 25).join("\n")}${lines.length > 25 ? `\n\n_(${lines.length - 25} more omitted.)_` : ""}`,
    );
  } finally {
    await agent.dispose();
  }
});

runner.command("memory", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  const args = event.text.replace(/^!\S+\s*/, "").trim().split(/\s+/);
  const provider = args[0];
  const topic = args.slice(1).join(" ");
  if (provider === undefined || provider.length === 0) {
    await msg.reply("Usage: `!memory <supermemory|honcho|mem0> <topic>`");
    return;
  }
  const envKey =
    provider === "supermemory"
      ? "SUPERMEMORY_API_KEY"
      : provider === "honcho"
        ? "HONCHO_API_KEY"
        : provider === "mem0"
          ? "MEM0_API_KEY"
          : undefined;
  if (envKey === undefined) {
    await msg.reply(`Unknown provider "${provider}". Use supermemory/honcho/mem0.`);
    return;
  }
  if (process.env[envKey] === undefined || process.env[envKey] === "") {
    await msg.reply(`Provider "${provider}" requires ${envKey} in .env.`);
    return;
  }
  await sendable(msg).sendTyping().catch(() => undefined);
  await msg.reply(`Memory provider \`${provider}\` is configured. Topic: "${topic}".`);
});

runner.command("cron", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  // cron-setup expects a Telegram Context to deliver messages; here we
  // just list the available jobs as a config probe.
  await msg.reply(
    [
      "**Cron jobs** (config-only probe — Discord delivery wires would go through `DeliveryRouter` in a future iteration)",
      "",
      "• `nightly dreaming sweep` — 03:00 UTC (configured for telegram-pro `.theokit/cron/jobs.json`)",
      "",
      "_See `examples/telegram-pro/src/cron-setup.ts` for the canonical impl._",
    ].join("\n"),
  );
});

runner.command("summary", async (event) => {
  if (event.platform !== "discord") return;
  const msg = event.discord.raw as Message;
  await sendable(msg).sendTyping().catch(() => undefined);
  // Direct call to runDreamNow (same as telegram-pro). Routing through
  // dispatchToAgent doesn't work because the agent lacks a "dreaming-sweep"
  // tool — it would just refuse politely.
  const { runDreamNow } = await import("./cron-setup.js");
  try {
    const result = await runDreamNow(CWD);
    await msg.reply(
      [
        `**Sweep status: ${result.status}**`,
        `• Facts: ${result.factsBefore} → ${result.factsAfter}`,
        `• Duplicates removed: ${result.duplicatesRemoved}`,
        `• Clusters: ${result.clustersCreated}`,
        `• Notes written: ${result.notesWritten}`,
      ].join("\n"),
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await msg.reply(`Sweep failed: ${errMsg.slice(0, 400)}`);
  }
});

// ────────────────────── error boundary + lifecycle ──────────────────────

const bot = adapter.getBot();
bot.on("error", (err) => {
  console.error("[discord error]", err.message);
});

process.on("SIGINT", async () => {
  console.log("\nShutting down — your data is safe on disk.");
  await runner.stop();
  process.exit(0);
});

console.log("Theo Pro Discord bot starting...");
console.log(`  workspace: ${CWD}`);
console.log(
  `  allowed-channels: ${ALLOWED_CHANNELS.size === 0 ? "(every channel the bot can see)" : Array.from(ALLOWED_CHANNELS).join(",")}`,
);

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

await runner.start();
const me = bot.user;
if (me !== null) {
  console.log(`Connected as ${me.tag} (id=${me.id}). Mention the bot or use !cmd to interact.`);
} else {
  console.log("Connected (bot.user not yet populated).");
}
