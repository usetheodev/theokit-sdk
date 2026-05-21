---
name: discord-pro-dogfood
description: Run a fully automated end-to-end dogfood of examples/discord-pro against a real Discord guild via Chrome DevTools Protocol. Boots the bot, attaches to a running Chrome tab with Discord Web, drives every `!cmd` text-trigger, captures replies from the DOM, validates outputs, and reports pass/fail per command. Same shape as the telegram-pro-dogfood skill — adapted for Discord's contenteditable Slate.js input + snowflake message IDs.
---

# Quickstart — DO NOT REINVENT

**The script already exists.** Use this exact invocation:

```bash
# 1. Boot the bot in background (skip if `ps aux | grep tsx.*discord-pro` shows it running)
cd examples/discord-pro && nohup pnpm tsx --env-file=.env src/index.ts > /tmp/dcpro-dogfood.log 2>&1 & disown
sleep 15 && grep -E "Connected as|Error" /tmp/dcpro-dogfood.log | tail -1

# 2. Run the suite (canonical dogfood entrypoint)
cd /home/paulo/Projetos/usetheo/theokit-sdk
node .claude/skills/discord-pro-dogfood/lib/dogfood.mjs --channel-id 1506968335273693246
```

Required state before running:
- Chrome with `chrome://inspect/#remote-debugging` ON (DevToolsActivePort file at `~/.config/google-chrome/DevToolsActivePort`)
- A Discord Web tab open at `https://discord.com/channels/<guild>/<channel>` for the channel the bot is in
- Node 22+ active (`nvm use 22`)
- `DISCORD_BOT_TOKEN` + `OPENROUTER_API_KEY` in `examples/discord-pro/.env`
- Bot invited to a guild with `Send Messages` + `Read Message History` + `Message Content Intent` enabled
- `--channel-id <id>` if you have multiple Discord tabs open (otherwise the first `discord.com/channels/*` tab is picked)

Expected output: `Total: 18 | PASS: 16+ | FAIL: 0-2 | SKIP: 0-3`. Snapshot at `.claude/knowledge-base/reviews/discord-pro-dogfood-YYYY-MM-DD.md`.

# Full reference (read only if quickstart fails)

You are running the discord-pro live dogfood. This skill validates the bot end-to-end as a real user would — typing `!cmd` in Discord Web, watching replies arrive — but 100% automated via CDP.

## Prerequisites (verify BEFORE running)

```bash
# 1. Chrome must be running with remote-debugging-port enabled
test -f /home/paulo/.config/google-chrome/DevToolsActivePort || {
  echo "ABORT: Chrome remote-debugging not enabled. Open chrome://inspect/#remote-debugging → toggle ON."
  exit 1
}

# 2. Discord Web tab with the target channel must be open
# (Verified inside the script — page list is part of the CDP probe.)

# 3. Bot's .env must have DISCORD_BOT_TOKEN + provider key
test -f examples/discord-pro/.env || {
  echo "ABORT: examples/discord-pro/.env not found"
  exit 1
}

# 4. No bot already running (would conflict on identify)
ps aux | grep -E "tsx.*discord-pro/src/index" | grep -v grep && {
  echo "WARN: existing bot detected — will reuse it (skip auto-boot)."
}
```

If any check fails, STOP and report to the user with the exact mitigation step.

## Process

### Phase 1 — Boot the bot (idempotent)

If no bot is currently running, start one in background:

```bash
cd examples/discord-pro
source ~/.nvm/nvm.sh > /dev/null 2>&1 && nvm use 22 > /dev/null 2>&1
nohup npx tsx --env-file=.env src/index.ts > /tmp/dcpro-dogfood.log 2>&1 &
disown
sleep 15
grep -E "Connected as|Error" /tmp/dcpro-dogfood.log | tail -1
```

Verify "Connected as Theo Pro Dev#XXXX" appears in the log within 20s. If "Used disallowed intents" appears, the Message Content Intent toggle in Discord Developer Portal is OFF — abort and tell the user. Do NOT proceed without a green boot.

### Phase 2 — Run the CDP-driven dogfood

```bash
node .claude/skills/discord-pro-dogfood/lib/dogfood.mjs 2>&1 | tee /tmp/dcpro-dogfood-result.log
```

The dogfood script:

1. Reads `DevToolsActivePort` to get the Chrome WebSocket URL.
2. Connects via `ws://...`.
3. Finds the Discord Web tab via the `discord.com/channels/*` URL prefix.
4. Attaches to the page target (`Target.attachToTarget`).
5. For each command in the suite:
   - Reads max `li[id^="chat-messages-"]` snowflake id as baseline
   - Types `!cmd` via `document.execCommand('insertText', ...)` on the Slate.js `div[role="textbox"]` with aria-label starting "Message"
   - Presses Enter via `Input.dispatchKeyEvent`
   - Polls the DOM until messages with id > baseline appear
   - Distinguishes OUT (your send, has author `h3` header) from IN (bot reply, has bot tag span)
   - Validates the IN reply against expected patterns
6. Writes a report to `.claude/knowledge-base/reviews/discord-pro-dogfood-{YYYY-MM-DD}.md`.

### Phase 3 — Triage failures

If ANY command fails, the report lists:
- Which command failed
- The expected pattern
- The actual reply (truncated to 600 chars)
- The bot's log entries (`grep` window from `/tmp/dcpro-dogfood.log`)

Triage rule:
- **Timeout (no reply within waitMs)** → check `/tmp/dcpro-dogfood.log` for runtime errors. Common: rate-limit from OpenRouter (~10 req/min free tier), Discord permission issue (bot can't send in that channel).
- **Reply pattern mismatch** → real bug OR pattern too strict. If the bot's reply is correct-but-different, relax the pattern. If wrong, investigate.
- **"Used disallowed intents"** → bot can't boot. Verify Message Content Intent toggle in Developer Portal → Bot section → Privileged Gateway Intents. Save changes.

Repeat triage → fix → rerun until 100% pass.

### Phase 4 — Cleanup

```bash
# Stop the bot we started
pkill -f "tsx.*discord-pro/src/index"
```

Report final status to the user:
- Total commands tested
- Pass / fail counts
- Bugs found AND fixed
- Path to the snapshot file

## Test suite contract

The skill drives every `!cmd` registered in `examples/discord-pro/src/index.ts`. When you add a new command to the bot, add a matching entry to `lib/dogfood.mjs` `COMMANDS` array.

Current coverage (v0.1):

| Group | Commands |
|---|---|
| Basics | `!start`, `!help`, `!me`, `!cron` |
| Knowledge | `!wiki tools`, `!wiki nonexistent-topic-xyz`, `!recall jazz` |
| v1.1 generateObject | `!fact corinthians` |
| Context files | `!context` |
| Memory (env-gated) | `!memory supermemory`, `!memory honcho`, `!memory mem0` |
| Personality | `!personality`, `!personality coder`, `!personality poet`, `!personality none`, `!personality ghost`, free-text after `!personality coder` |
| Dreaming sweep | `!summary` |

**18 commands total.** If any are missing from `lib/dogfood.mjs`, ADD them before running.

## Behavioral rules

- **Never declare PASS without all commands green.** Yellow is not green.
- **Never skip a failing command.** Fix the bug OR document why the skip is acceptable.
- **Always validate the bug fix the same way it was found:** re-run the same CDP send via `--only "<command>"` after restart.
- **The bot must be the one we just booted.** Verify by sending `!start` and checking the agent id matches `dc-pro-grp-<channelId>-<userId>` or `dc-pro-dm-<userId>`.
- **Log everything to disk.** `/tmp/dcpro-dogfood.log` (bot stdout/stderr), `/tmp/dcpro-dogfood-result.log` (dogfood script), snapshot file.

## Out of scope (deliberately)

- **Image attachments** — would require automating Discord's file upload (drag-drop or paste). Skill validates the COMMAND surface; photo handler is covered by manual smoke when needed.
- **Inline buttons / Application Components** — Discord proper slash commands (`/cmd` via Application Commands API) are out of v0.1 scope. The bot uses `!cmd` text triggers.
- **DM-specific flows** — the dogfood targets a guild channel for stable URLs. DM testing is `--channel-id <dm-channel-id>` if needed.

## Rate-limit retry (built into the dogfood script)

`lib/dogfood.mjs` auto-retries any reply matching `(run error) ... rate_limit (HTTP 429)` up to 2 times with 75s backoff. Inter-scenario gap is 6s for LLM-heavy commands (`!fact`, `!recall`, `!summary`, free text), 1.5s otherwise.

If a run still hits rate-limit after retries, wait 1-2 hours and rerun. Do not weaken the patterns.

## Known limitations vs telegram-pro-dogfood

- **No `--user-id` resolution from Bot API** — Discord doesn't have an equivalent of `getUpdates` for inferring the conversation. The script uses the first `discord.com/channels/*` tab unless `--channel-id` is passed.
- **`!personality` voice probe is permissive** — discord-pro doesn't ship sample presets by default (no `.theokit/personalities/` in the example). The probe accepts the fallback "No personalities loaded" reply so the dogfood passes on a fresh install. To activate real preset probing, copy `examples/telegram-pro/.theokit/personalities/*.md` into the discord-pro CWD.
- **Slate.js input handling is fragile** — Discord Web rebuilds the contenteditable DOM aggressively. The skill uses `execCommand('insertText')` which goes through Slate's input handler; if Discord migrates to a different editor (Lexical, etc), this skill breaks at that exact selector. Mitigation: keep the `data-slate-editor="true"` selector aligned with current Discord Web.
