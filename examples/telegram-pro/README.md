# Telegram Pro — flagship multimodal demo

A real, deployable Telegram bot built on `@usetheo/sdk` v1. **~900 LoC, ~95% SDK surface coverage.**

This example reproduces the five highest-value patterns from OpenClaw's 187-file `extensions/telegram` AND exercises the SDK's full feature set in one process: persistence, memory, hooks, sandbox, MCP, cron, providers, skills, context, plugins.

---

## Features by SDK surface

| SDK feature | What the bot does | Code |
|---|---|---|
| **Persistence (ADRs D17–D21)** | Registry + JSONL + sessions corpus + mutex. Survives `kill -9`. | (SDK internal) |
| **Memory + auto-write** | `Remember: ...` → MEMORY.md. `/me` lists, `/recall` searches `corpus="sessions"`. | [`commands.ts`](./src/commands.ts) |
| **Active Memory** | `activeRecall.enabled` in agent config — relevant facts auto-injected. | [`agent.ts`](./src/agent.ts) |
| **Dreaming sweep** | `/summary` runs `Memory.runDreamingSweep` on demand. | [`cron-setup.ts`](./src/cron-setup.ts) |
| **Cron scheduler** | `Cron.start` on boot. `/remind` adds jobs. Nightly sweep at 03:00 UTC. | [`cron-setup.ts`](./src/cron-setup.ts) |
| **Shell tool + sandbox** | `local.sandboxOptions.enabled: true` — restricts writes to cwd. | [`agent.ts`](./src/agent.ts) |
| **`.theokit/hooks.json` policy** | `preToolUse` hook blocks `rm`, `sudo`, `dd`, `mkfs`, `shutdown`, etc. | [`hooks-setup.ts`](./src/hooks-setup.ts) |
| **MCP stdio (filesystem)** | `npx @modelcontextprotocol/server-filesystem` scoped to workspace. | [`sdk-config.ts`](./src/sdk-config.ts) |
| **MCP stdio (web search)** | `npx tavily-mcp` — surfaces `tavily-search`, `tavily-extract`, `tavily-crawl`, `tavily-map` when `TAVILY_API_KEY` is set. | [`sdk-config.ts`](./src/sdk-config.ts) |
| **Inline custom tool** | `current_time()` returns ISO-8601 UTC. Always registered. | [`agent.ts`](./src/agent.ts) |
| **Per-call tool override (`SendOptions.tools`)** | `/tool uuid|roll|base64|hash|timezone` injects ONE ad-hoc tool per call. LLM doesn't see shell/MCP/memory for these. | [`ad-hoc-tools.ts`](./src/ad-hoc-tools.ts), [`index.ts`](./src/index.ts) |
| **Provider routing** | Anthropic → OpenAI → OpenRouter fallback chain when keys are present. | [`sdk-config.ts`](./src/sdk-config.ts) |
| **Skills** | `.theokit/skills/recipe-suggest/SKILL.md` + `morning-routine/SKILL.md`. | [`workspace-seeds.ts`](./src/workspace-seeds.ts) |
| **Context manager** | `.theokit/context.json` injects README content into the system prompt. | [`workspace-seeds.ts`](./src/workspace-seeds.ts) |
| **Plugins manifest** | `.theokit/plugins.json` with declared provider entry. | [`workspace-seeds.ts`](./src/workspace-seeds.ts) |
| **Inline subagents** | `code_writer` + `researcher` declared (cloud-dispatchable). | [`subagents.ts`](./src/subagents.ts) |
| **Wiki corpus** | `.theokit/memory/wiki/*.md`. `/wiki` does server-side search. | [`wiki-search.ts`](./src/wiki-search.ts) |
| **`RunResult.error`** | `result.error.message` + `code` surfaced to the user on failures. | [`index.ts`](./src/index.ts) |

### Telegram patterns (OpenClaw-inspired)

| Pattern | OpenClaw source | Code here |
|---|---|---|
| Voice transcription (Whisper) | `bot-message-context.audio-transcript.test-support.ts` | [`transcribe.ts`](./src/transcribe.ts) |
| Photo/sticker vision + cache | `sticker-vision.runtime.ts` + `sticker-cache.ts` | [`vision.ts`](./src/vision.ts) |
| Inline buttons + callback routing | `inline-keyboard.ts` + `approval-callback-data.ts` | [`buttons.ts`](./src/buttons.ts) |
| Group `@mention` gating | `group-policy.ts` | [`group-policy.ts`](./src/group-policy.ts) |
| Forum topic scoping | `topic-conversation.ts` | [`agent.ts`](./src/agent.ts) |

---

## Setup

### 1. Get a Telegram bot token

Message **@BotFather** on Telegram:
1. `/newbot` → display name → username (must end in `bot`).
2. Copy the token from BotFather's reply.
3. Recommended for group support: `/setprivacy` → pick your bot → **Disable**.
   Without this, the bot only sees `/commands` in groups, not @-mentions.

### 2. Get provider keys

| Provider | Used for | Get key |
|---|---|---|
| **OpenRouter** (required) | Text + vision (gemini-2.0-flash-001) | [openrouter.ai](https://openrouter.ai) — free tier OK |
| OpenAI (optional) | Whisper voice + dreaming embeddings | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Groq (optional) | Whisper voice (free tier, fast) | [console.groq.com/keys](https://console.groq.com/keys) |
| Anthropic (optional) | Provider fallback chain | [console.anthropic.com](https://console.anthropic.com) |
| **Tavily** (optional) | Real-time web search via MCP (free tier: 1000 req/month) | [tavily.com](https://tavily.com) |

### 3. Configure

```bash
cp .env.example .env
# Edit .env with at minimum TELEGRAM_BOT_TOKEN + OPENROUTER_API_KEY + THEOKIT_API_KEY
pnpm install --ignore-workspace
pnpm dev
```

> **Node version**: `pnpm dev` runs `tools/dev.sh` which auto-sources `nvm` and switches to the `.nvmrc` version (currently major Node 22). You don't need to `nvm use` first — the wrapper does it. If `nvm` isn't installed, you'll get a clear error pointing at the engines floor (`>=22.12.0` per ADR D01).

### 4. Lock the bot to your user (recommended)

After `/start`, the bot prints your user-id. Add it to `.env`:

```dotenv
TELEGRAM_ALLOWED_USERS=YOUR_ID_HERE
```

Restart. The bot now refuses messages from anyone else.

---

## Try every feature

| Surface | Type this | Expect |
|---|---|---|
| Memory write | `Remember: meu time é Corinthians` | "Got it." + MEMORY.md updated |
| Memory read | `/me` | List of facts |
| Sessions recall | `/recall corinthians` | LLM uses `memory_search corpus="sessions"` |
| Wiki search | `/wiki tools` | Reads `.theokit/memory/wiki/tools.md` server-side |
| Skills | `/skills` | `recipe-suggest`, `morning-routine` |
| Cron list | `/cron` | Nightly dream + any /remind jobs |
| Reminder | `/remind 0 9 * * 1 \| beba água` | Cron job scheduled |
| Dreaming on-demand | `/summary` | Dedup + cluster facts |
| Subagents | `/agents` | Lists `code_writer` + `researcher` (cloud-only dispatch) |
| Reset thread | `/reset` | Deletes thread JSONL, keeps memory facts |
| Voice | (record audio in Telegram) | Transcript → reply |
| Photo / sticker | (send image) | Vision description → reply |
| Inline buttons | `Sugere 3 restaurantes` | LLM emits `[BUTTONS: A \| B \| C]` → keyboard |
| Shell | `Lista os arquivos` | LLM runs `ls` via shell tool |
| Policy block | `roda rm -rf /` | Hook denies — LLM reports policy verbatim |
| MCP write | `Cria notas.md com 5 itens da lista` | Filesystem MCP creates the file |
| Web search (Tavily) | `Qual o preço do Bitcoin hoje?` (requires `TAVILY_API_KEY`) | LLM invokes `tavily-search` → real-time answer with sources |
| Ad-hoc per-call tool | `/tool uuid` / `/tool roll 3d6` / `/tool hash sha256 hello` | LLM sees ONLY that one tool (no shell/MCP fallback) — replies with real UUID v4 / dice rolls / SHA256 |
| Group | (add bot to group + `@your_bot oi`) | Replies only on mention |
| Forum topics | (group with Topics on, message in topic) | Per-topic isolated agent |

---

## Honest review of patterns

After live-testing every surface, here's what we learned:

### Works reliably
- Persistence + restart-proofing (rock solid; survives `kill -9`)
- Memory write/read + auto-write on `Remember:` prefix
- Vision via Gemini multimodal + disk cache
- Shell tool + policy hook (real `rm -rf /` block)
- MCP `write_file` (single tool call)
- Cron persistence + scheduling
- `/wiki` (after migrating to server-side search — gemini-flash was unreliable with multi-step MCP calls)

### Requires care
- **Single-step tool calls work; multi-step is brittle on gemini-flash.** The `/wiki` flow (list_directory → grep filename → read_text_file) failed multiple times because the model hallucinated tool calls or printed shell syntax as text. **Fix**: bypass the LLM for deterministic flows (list + grep). The `/wiki` command runs in TypeScript, not via the LLM, and is 100% reliable.
- **System prompts must explicitly list available tools.** The model refused `memory_search` until the prompt listed it. Don't rely on the schema alone.
- **Aggressive action-bias requires concrete examples in the system prompt.** Even with "do it immediately" instructions, the model would still ask "what content?". Adding 4 example patterns in Portuguese fixed it.

### Cloud-only (declared but not dispatchable locally)
- **Subagents (`agents:` config + `task` tool).** Declarations serialize to the cloud payload. The local runtime does NOT expose a `task` tool in SDK v1.0. The system prompt explicitly tells the model not to claim it can dispatch.

### Web search (opt-in)
- **Tavily MCP (`tavily-mcp`).** Wired as an MCP stdio server, same pattern as the filesystem MCP. SDK v1.0 has no public `tools:` field on `AgentOptions` for inline custom tools — MCP servers are the supported extension point. Set `TAVILY_API_KEY` in `.env` and the agent gets four tools (`tavily-search`, `tavily-extract`, `tavily-crawl`, `tavily-map`) at boot. Without the key, the agent falls back to `shell + curl` for ad-hoc lookups (still works for public APIs like `api.github.com`).

### LLM-side caveats (not SDK bugs)
- **OpenRouter free tier ≈ 10 req/min.** Bursts of messages → silent run errors. The bot now coaches: "rate-limit, wait 10–20s".
- **gemini-flash-001 deprecation messages.** When MCP server marks a tool as deprecated, gemini reads "deprecated" and refuses both the deprecated AND its replacement. Workaround: hide deprecated tools from the LLM (third-party server issue, not SDK).

---

## Architecture

```
src/
├── index.ts          Bot entry: grammy bot.command + bot.on handlers
├── agent.ts          Per-chat agent factory (thread-scoped agentId, SYSTEM_PROMPT)
├── commands.ts       /me /remember /forget /recall slash-commands (delegated handlers)
├── sdk-config.ts     buildProviderRouting + buildMcpServers
├── subagents.ts      TELEGRAM_PRO_SUBAGENTS map (code_writer + researcher)
├── workspace-seeds.ts  Writes .theokit/skills/*, plugins.json, context.json, wiki/*
├── hooks-setup.ts    Writes .theokit/hooks.json + policy.js shell-gate
├── cron-setup.ts     initCron + scheduleReminder + runDreamNow
├── transcribe.ts     Voice → Whisper (OpenAI / Groq)
├── vision.ts         Image → Gemini multimodal + .theokit/cache/vision/ cache
├── buttons.ts        [BUTTONS: ...] marker parsing + grammy InlineKeyboard
├── group-policy.ts   @-mention gating + reply-to-bot detection
├── format.ts         Telegram 4096-char split helper
├── memory-store.ts   Direct MEMORY.md reader (no LLM round-trip for /me)
├── wiki-search.ts    Server-side wiki search (bypasses LLM for reliability)
├── ad-hoc-tools.ts   /tool registry: uuid, roll, base64, hash, timezone
└── dreaming.ts       Wrapper around Memory.runDreamingSweep with provider auto-detect
```

Total: ~900 LoC. Each file under 200 lines.

---

## Stop and clean up

`Ctrl-C` in the terminal. All state on disk is consistent.

Wipe everything:
```bash
rm -rf .theokit notas.md plano-semanal.md
```

Delete one user's data:
```bash
rm -rf .theokit/agents/tg-pro-dm-<userId>/
```
