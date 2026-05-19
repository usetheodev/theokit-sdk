---
name: telegram-pro-dogfood
description: Run a fully automated end-to-end dogfood of examples/telegram-pro against a real Telegram chat via Chrome DevTools Protocol. Boots the bot, attaches to a running Chrome tab with Telegram Web, drives every v1.0+v1.1+v1.2 command, captures replies from the DOM, validates outputs, and reports pass/fail per command with regression detection.
---

# Quickstart — DO NOT REINVENT

**The script already exists.** Don't write your own CDP harness, don't synthesize Updates, don't refactor the bot to expose `bot.handleUpdate`. Use this exact two-line invocation:

```bash
# 1. Boot the bot in background (skip if `ps aux | grep tsx.*telegram-pro` shows it running)
cd examples/telegram-pro && nohup pnpm tsx --env-file=.env src/index.ts > /tmp/tgpro-dogfood.log 2>&1 & disown
sleep 8 && grep "Connected as @" /tmp/tgpro-dogfood.log

# 2. Run the suite (this is the canonical dogfood entrypoint)
cd /home/paulo/Projetos/usetheo/theokit-sdk
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

Required state before running:
- Chrome with `chrome://inspect/#remote-debugging` ON (DevTools port file at `~/.config/google-chrome/DevToolsActivePort`)
- A Telegram Web tab open at `https://web.telegram.org/a/#8982152421` (or wherever `@theo_paulo_bot` is)
- Node 22+ active (`nvm use 22`)
- `TELEGRAM_BOT_TOKEN` + `OPENROUTER_API_KEY` in `examples/telegram-pro/.env` (auto-loaded by tsx)
- `--user-id <id>` if `TELEGRAM_ALLOWED_USERS` is empty in `.env`

Expected output: `Total: 25 | PASS: 25 | FAIL: 0`. Snapshot at `.claude/knowledge-base/reviews/telegram-pro-dogfood-YYYY-MM-DD.md`.

# Full reference (read only if quickstart fails)

You are running the telegram-pro live dogfood. This skill validates the entire bot end-to-end as a real user would — typing commands in Telegram Web, watching replies arrive — but 100% automated via Chrome DevTools Protocol (CDP).

## Prerequisites (verify BEFORE running)

Run this preflight block first:

```bash
# 1. Chrome must be running with remote-debugging-port enabled
test -f /home/paulo/.config/google-chrome/DevToolsActivePort || {
  echo "ABORT: Chrome remote-debugging not enabled. The user must open chrome://inspect/#remote-debugging and toggle 'Allow remote debugging for this browser instance' ON, then approve the permission dialog when this skill connects."
  exit 1
}

# 2. Telegram Web tab with @theo_paulo_bot must be open
# (We verify this from inside the script — page list is part of CDP probe.)

# 3. Bot's .env must have TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_USERS + provider key
test -f examples/telegram-pro/.env || {
  echo "ABORT: examples/telegram-pro/.env not found"
  exit 1
}

# 4. No bot already running (would conflict on getUpdates)
ps aux | grep -E "tsx.*telegram-pro/src/index" | grep -v grep && {
  echo "WARN: existing bot detected — will reuse it (skip auto-boot)."
}
```

If any check fails, STOP and report to the user with the exact mitigation step.

## Process

### Phase 1 — Boot the bot (idempotent)

If no bot is currently running, start one in background:

```bash
cd examples/telegram-pro
source ~/.nvm/nvm.sh > /dev/null 2>&1 && nvm use 22 > /dev/null 2>&1
nohup npx tsx --env-file=.env src/index.ts > /tmp/tgpro-dogfood.log 2>&1 &
disown
sleep 8
grep -E "Connected as @|Error" /tmp/tgpro-dogfood.log | tail -1
```

Verify "Connected as @theo_paulo_bot" appears in the log within 10s. If "409 Conflict" appears, another bot instance has the token — kill it (`ps aux | grep telegram-pro` → `kill <pid>`) and retry. Do NOT proceed without a green boot.

### Phase 2 — Run the CDP-driven dogfood

```bash
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs 2>&1 | tee /tmp/tgpro-dogfood-result.log
```

The dogfood script:

1. Reads `DevToolsActivePort` to get the Chrome WebSocket URL.
2. Connects via `ws://...`. No HTTP discovery (M144+ doesn't expose it).
3. Finds the Telegram Web tab matching the bot's chat (`web.telegram.org` + the user_id from `.env`).
4. Attaches to the page target (`Target.attachToTarget`).
5. For each command in the suite:
   - Reads current bubble count from `.Message` selector
   - Types command via `document.execCommand('insertText', ...)` on `#editable-message-text`
   - Presses Enter via `Input.dispatchKeyEvent`
   - Polls the DOM until a new inbound bubble appears OR the timeout expires
   - Validates the reply against expected patterns (regex match per command)
   - Records pass/fail
6. Writes a report to `.claude/knowledge-base/reviews/telegram-pro-dogfood-{YYYY-MM-DD}.md`.

### Phase 3 — Triage failures

If ANY command fails, the report lists:
- Which command failed
- The expected pattern
- The actual reply (truncated to 600 chars)
- The bot's log entries between send and read (`grep` window from `/tmp/tgpro-dogfood.log`)

Triage rule:
- **400 Markdown error** → fix is to drop `parse_mode: "Markdown"` from the affected reply (Telegram V1 mis-parses arbitrary content with `_*[]`). Apply the fix, restart bot, rerun ONLY the failing command via `node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --only "<command>"`.
- **Timeout (no reply within 20s)** → bot crashed or rate-limited. Check log; if rate-limit (OpenRouter free tier ~10 req/min), wait 30s and retry the whole suite.
- **Reply pattern mismatch** → real bug. Investigate, fix, restart, rerun.

Repeat triage → fix → rerun cycle until 100% pass. Do NOT declare success with any red.

### Phase 4 — Cleanup

```bash
# Stop the bot we started (only if we started it; preserve user-started bots)
test -f /tmp/tgpro-dogfood.pid && kill "$(cat /tmp/tgpro-dogfood.pid)" 2>/dev/null
rm -f /tmp/tgpro-dogfood.pid
```

Report final status to the user with:
- Total commands tested
- Pass / fail counts
- Any bugs found AND fixed during the cycle
- Path to the snapshot file

## Test suite contract

The skill drives the FULL command surface of telegram-pro (every `bot.command(...)` registered in `src/index.ts`). When you add a new command to the bot, add a matching entry to `lib/dogfood.mjs` `COMMANDS` array. The skill is the contract — if a command isn't tested here, it doesn't ship.

Current coverage (v1.0 + v1.1 + v1.2):

| Group | Commands |
|---|---|
| Basics | `/start`, `/help`, `/me`, `/recall`, `/wiki`, `/agents`, `/skills`, `/cron` |
| Memory | `/summary`, `/skill <name>` |
| DX | `/tool list`, `/tool roll`, `/tool uuid`, `/tool hash` |
| Loops | `/loop`, `/loops`, `/stop_loop` |
| Reset | `/reset` |
| v1.1 | `/fact <topic>` |
| **v1.2** | `/factstream`, `/migrate_memory`, `/memory_lance`, `/notion`, `/stream` (on/off/info), generic text under `/stream on` |

If any of these are missing from `lib/dogfood.mjs`, ADD them before running. The skill is the source of truth.

## Behavioral rules

- **Never declare PASS without all commands green.** Yellow is not green.
- **Never skip a failing command.** Fix the bug or report it as a blocker.
- **Always validate the bug fix the same way it was found:** re-run the same CDP send via `--only "<command>"` after restart, not via a different code path.
- **The bot must be the one we just booted** (or one already running with our source tree) — verify by reading `agentId` from `/start` reply matches `tg-pro-dm-<TELEGRAM_ALLOWED_USERS[0]>`.
- **Log everything to disk.** `/tmp/tgpro-dogfood.log` (bot stderr/stdout), `/tmp/tgpro-dogfood-result.log` (dogfood script stdout), snapshot file in `.claude/knowledge-base/reviews/`.

## Out of scope (deliberately)

- **Voice / vision / photo / sticker handlers** — require file uploads from a real Telegram client; CDP can't easily attach files. Documented as `MANUAL` in the suite; flagged but not run.
- **OAuth real flow** (`/notion` with `NOTION_OAUTH_CLIENT_ID` set) — browser callback can't reach a bot in headless mode. Skill tests config-only path; full flow requires `pnpm exec theokit-mcp-auth-notion --setup` outside the bot (one-time).
- **`/remind <cron> | <msg>` scheduling** — would need to wait for cron fire (minimum 10s); covered in `/cron` listing instead.
- **`/loop` long-running** — covered by triggering + checking initial confirmation; doesn't wait for N loop fires.

## Known-good model pinning (2026-05-19)

Two bot commands pin `openai/gpt-4o-mini` instead of the agent's default Gemini, due to provider-specific issues that broke the dogfood:

1. **`/factstream`** uses `Agent.streamObject<T>` with a Zod schema. Gemini 2.0 Flash sometimes returns plain text instead of calling the structured `output` tool, producing `"Streaming failed: The model returned text instead of calling the output tool"`. GPT-4o-mini has reliable tool-call compliance with Zod schemas. Fix: `src/index.ts` `/factstream` handler pins `model: { id: "openai/gpt-4o-mini" }`.

2. **`/tool <name>`** uses `agent.send(..., { tools: [singleTool] })` — single-tool ad-hoc calls require strict tool-calling. Gemini also (separate from the streamObject issue) hits OpenRouter free-tier rate-limit faster than gpt-4o-mini because the agent's default model is also Gemini, so multiple LLM-driven commands in the suite share one bucket. GPT-4o-mini lives on a different bucket. Fix: `src/index.ts` `/tool` handler pins `model: { id: "openai/gpt-4o-mini" }`.

If a future dogfood shows similar tool-call or rate-limit failures on commands using the default model, consider the same pinning strategy.

## Rate-limit retry (built into the dogfood script)

`lib/dogfood.mjs` automatically retries any reply matching `(run error) ... rate_limit (HTTP 429)` up to 2 times with 75-second backoff per retry. This handles OpenRouter free-tier throttling without requiring user intervention. Inter-scenario gap is 6s for LLM-heavy commands (regex match: `/tool`, `/fact`, `/factstream`, `/loop`, `/recall`, free text), 1.5s otherwise.

If a dogfood run still hits rate-limit after retries (rare; only when daily quota of ~200 req/day is exhausted), wait 1-2 hours and rerun. Do not skip or weaken the patterns — the retry logic is the correct mitigation.
