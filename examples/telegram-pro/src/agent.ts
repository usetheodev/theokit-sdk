import { Agent, type CustomTool, UnknownAgentError, type SDKAgent } from "@usetheo/sdk";
import type { Context } from "grammy";

import { buildMcpServers, buildProviderRouting } from "./sdk-config.js";
import { TELEGRAM_PRO_SUBAGENTS } from "./subagents.js";

/**
 * Inline custom tools registered with every Theo Pro agent. Demonstrates the
 * SDK `AgentOptions.tools` surface — handlers run in-process, no MCP wrapper
 * needed. Tools are local-only (cloud agents reject non-empty `tools`).
 */
export const TELEGRAM_PRO_CUSTOM_TOOLS: CustomTool[] = [
  {
    name: "current_time",
    description:
      "Return the bot host's current UTC time as ISO-8601. Use when the user asks the time, date, or 'que horas são'.",
    inputSchema: { type: "object", properties: {} },
    handler: () => new Date().toISOString(),
  },
];

/**
 * Thread-aware per-chat agent factory.
 *
 * Identity rules:
 *  - DM       → agentId = `tg-pro-dm-<userId>`             (one shared thread per user)
 *  - Group    → agentId = `tg-pro-grp-<chatId>-<userId>`   (one per user inside the group)
 *  - Topic    → agentId = `tg-pro-tpc-<chatId>-<threadId>` (one per forum topic)
 *
 * Memory is always scoped to `userId` (so a user's facts follow them across
 * DM ↔ group ↔ topic) while CONVERSATION HISTORY (session JSONL) is scoped
 * per-thread so threads don't bleed into each other.
 *
 * Resume-vs-create flow (SDK v1.0.x+):
 *   `Agent.resume(id)` throws `UnknownAgentError` on cold-miss. We catch
 *   that and fall through to `Agent.create({ agentId, ...full options })`
 *   for first-contact. On HIT, the SDK deep-merges `local` so we no longer
 *   need to defensively pass `settingSources` on every resume.
 */

export const SYSTEM_PROMPT = [
  "You are Theo Pro — a personal assistant on Telegram with multimodal awareness AND full filesystem + shell capability.",
  "",
  "═══════ BEHAVIOR — INVIOLABLE ═══════",
  "BIAS TOWARD ACTION. When the user asks you to do something, DO IT IMMEDIATELY.",
  "DO NOT ASK for content, items, names, or any clarifying input when a sensible default is inferable.",
  "Confirm AFTER acting, in past tense: 'Wrote 5 items to notas.md' — never 'I will write...'.",
  "",
  "Concrete examples (FOLLOW THESE PATTERNS):",
  "• User: 'Cria notas.md com 5 itens da minha lista de compras'",
  "  YOU: immediately call write_file({ path: 'notas.md', content: '- leite\\n- pão\\n- ovos\\n- arroz\\n- frutas\\n' }) then reply 'Criei notas.md com leite, pão, ovos, arroz, frutas.'",
  "• User: 'Salva uma piada em piada.txt'",
  "  YOU: write_file with a short joke immediately, then reply 'Salvei a piada em piada.txt.'",
  "• User: 'Lista os arquivos'",
  "  YOU: list_directory({ path: '.' }) immediately, no follow-up question.",
  "• User: 'Cria um plano semanal para ler 3 livros'",
  "  YOU: write_file({ path: 'plano-semanal.md', content: '...' }) with a real plan, then reply 'Criei plano-semanal.md.'",
  "",
  "Only ask back when:",
  "  (a) the user's intent is genuinely ambiguous (e.g., 'manda email' — which email? to whom?), OR",
  "  (b) the action is irreversibly destructive (rm of important data).",
  "",
  "═══════ AVAILABLE TOOLS ═══════",
  "- memory_search({ query, corpus }): search the user's memory. corpus ∈ {'memory', 'sessions', 'wiki', 'all'}. Use 'sessions' for past chats, 'wiki' for the knowledge base.",
  "- memory_get({ path }): read a specific memory file.",
  "- shell({ command }): run a shell command in the workspace cwd. Policy hook blocks `rm`, `sudo`, `dd`, `mkfs`, `shutdown`, `reboot`, `kill`. Use for `ls`, `cat`, `grep`, `pwd`, `wc`, etc.",
  "- current_time(): inline custom tool. Returns the bot host's current UTC time as ISO-8601. Use it whenever the user asks the time, date, or 'que horas são'.",
  "- Filesystem MCP tools (`@modelcontextprotocol/server-filesystem` 2026.1.14): list_directory, read_text_file, write_file, create_directory, search_files, edit_file, move_file. Scoped to workspace cwd. FULL WRITE ACCESS — no confirmations needed.",
  "  IMPORTANT: use read_text_file (NOT the deprecated read_file).",
  "- Tavily MCP tools (available when TAVILY_API_KEY is set): tavily-search (real-time web search + AI summary), tavily-extract (full-page content), tavily-crawl (multi-page), tavily-map (site structure). Use these for ANY question about current events, recent docs, today's news, real-time data — DO NOT guess from training data when web search is available.",
  "- Available skills (listed below by the SDK): you can invoke skills by name when their description matches the task. Skills loaded: recipe-suggest, morning-routine.",
  "",
  "NOTE: Subagents (code_writer, researcher) are declared in this agent's config but `task`-tool dispatch is CLOUD-ONLY in SDK v1.0. Do NOT claim to dispatch them locally — just do the work yourself with the tools above.",
  "",
  "═══════ MULTIMODAL INPUTS ═══════",
  "- Voice → [voice transcript: ...]. Reply to the transcript content.",
  "- Image/sticker → [image description: ...]. Treat it as if you saw it.",
  "",
  "═══════ INLINE BUTTONS ═══════",
  "When you genuinely need a yes/no/picker decision (not for trivial 'what content?' questions), append ONE marker line at the END:",
  "  [BUTTONS: Option A | Option B | Option C]",
  "Up to 5 options. The user taps one; their choice arrives as the next turn.",
  "",
  "═══════ MEMORY WRITES ═══════",
  "When the user shares a preference / fact about themselves, mirror it back as `Remember: <fact>` on its own line — the SDK auto-persists it to MEMORY.md.",
  "",
  "═══════ STYLE ═══════",
  "Concise (1-3 sentences unless the user asks for detail). Markdown for emphasis (**bold**, `code`). Confirm completed actions in past tense ('Wrote 4 items to notas.md'), not future ('I will write...').",
].join("\n");

export function resolveUserId(ctx: Context): string {
  if (ctx.from?.id !== undefined) return String(ctx.from.id);
  if (ctx.chat?.id !== undefined) return String(ctx.chat.id);
  return "anonymous";
}

export function resolveAgentId(ctx: Context): string {
  const userId = resolveUserId(ctx);
  const chat = ctx.chat;
  if (chat === undefined || chat.type === "private") {
    return `tg-pro-dm-${userId}`;
  }
  const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
  if (typeof threadId === "number") {
    return `tg-pro-tpc-${chat.id}-${threadId}`;
  }
  return `tg-pro-grp-${chat.id}-${userId}`;
}

export interface AgentFactoryOptions {
  apiKey: string;
  cwd: string;
}

export async function getAgent(ctx: Context, opts: AgentFactoryOptions): Promise<SDKAgent> {
  const agentId = resolveAgentId(ctx);
  const userId = resolveUserId(ctx);

  // Try resume first. The SDK throws UnknownAgentError on cold-miss; we
  // catch it and fall through to Agent.create. On HIT, the SDK deep-merges
  // our `local: { cwd }` over the persisted options, preserving
  // settingSources/sandboxOptions/etc.
  //
  // `tools` MUST be re-supplied on every resume: handler functions are not
  // persisted (allow-list strip), so the registry-restored options have
  // `tools === undefined`. Without re-passing, custom tools would silently
  // disappear after a bot restart.
  try {
    return await Agent.resume(agentId, {
      apiKey: opts.apiKey,
      local: { cwd: opts.cwd },
      tools: TELEGRAM_PRO_CUSTOM_TOOLS,
      // Re-supply systemPrompt on resume so prompt changes shipped in a
      // bot update reach existing users. Without this, Agent.resume picks
      // the persisted prompt and new instructions (e.g., 'current_time
      // exists') never reach the LLM.
      systemPrompt: SYSTEM_PROMPT,
    });
  } catch (err) {
    if (!(err instanceof UnknownAgentError)) throw err;
  }

  // Cold path: create with the full config. The SDK now persists `context`,
  // `providers`, and `agents` so subsequent resumes see them too.
  const providers = buildProviderRouting();
  const mcpServers = buildMcpServers(opts.cwd);
  return Agent.create({
    agentId,
    apiKey: opts.apiKey,
    model: { id: "google/gemini-2.0-flash-001" },
    // settingSources ["project","plugins"] enables loading of:
    //   - .theokit/hooks.json          (shell policy)
    //   - .theokit/skills/*/SKILL.md   (project-scoped skills)
    //   - .theokit/context.json        (context-manager sources)
    //   - .theokit/plugins.json        (plugin manifest)
    // sandbox restricts shell writes to cwd and blocks network egress; combined
    // with the preToolUse policy hook, this is "safe by default".
    local: {
      cwd: opts.cwd,
      settingSources: ["project", "plugins"],
      sandboxOptions: { enabled: true },
    },
    memory: {
      enabled: true,
      namespace: "tg-pro",
      scope: "user",
      userId,
      activeRecall: { enabled: true, queryMode: "recent" },
    },
    // Subagents — declared inline. Cloud runtime dispatches them via the
    // `task` tool. Local runtime does NOT expose `task` in SDK v1.0; the
    // declarations still serialize cleanly for cloud deployment.
    agents: TELEGRAM_PRO_SUBAGENTS,
    // Context manager auto-reads .theokit/context.json and injects the
    // listed file contents into the system prompt at send time.
    context: { manager: "file" },
    // Inline custom tools — SDK v1.x surface. Handlers run in-process.
    tools: TELEGRAM_PRO_CUSTOM_TOOLS,
    ...(providers !== undefined ? { providers } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    systemPrompt: SYSTEM_PROMPT,
  });
}
