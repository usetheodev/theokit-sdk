# telegram-pro Dogfood — 2026-05-21T09:56:18.343Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 38 ✅ | **Fail:** 3 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 398.0s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1564ms |  |
| 2 | `/help` | ✅ PASS | 1034ms |  |
| 3 | `/me` | ✅ PASS | 1034ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 6597ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 8585ms |  |
| 6 | `/agents` | ✅ PASS | 1031ms |  |
| 7 | `/skills` | ✅ PASS | 1040ms |  |
| 8 | `/summary` | ✅ PASS | 1048ms |  |
| 9 | `/reset` | ✅ PASS | 3561ms |  |
| 10 | `/cron` | ✅ PASS | 1527ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1535ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1520ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1526ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1518ms |  |
| 15 | `/tool list` | ✅ PASS | 1529ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 12109ms | pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: Ad-hoc tools (injected per-call |
| 17 | `/tool roll 3d6` | ✅ PASS | 2030ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 4044ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 6592ms |  |
| 20 | `/batch jazz` | ✅ PASS | 4043ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 3049ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1537ms |  |
| 23 | `/notion` | ✅ PASS | 1525ms |  |
| 24 | `/stream` | ✅ PASS | 1532ms |  |
| 25 | `/stream on` | ✅ PASS | 1531ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1539ms |  |
| 27 | `/stream off` | ✅ PASS | 2033ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1529ms |  |
| 29 | `/loops` | ✅ PASS | 2043ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 2028ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ❌ FAIL | 120205ms | pattern mismatch — failing: /(Status|turn|verdict).*?(completed|continue|done|failed|max turns)/ — r |
| 32 | `/pool` | ✅ PASS | 1525ms |  |
| 33 | `/memory supermemory jazz` | ❌ FAIL | 60013ms | pattern mismatch — failing: /Recalled|fact/ — reply head: Usage: /memory <provider> <topic> |  | Pro |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 2044ms |  |
| 36 | `/context` | ✅ PASS | 2634ms |  |
| 37 | `/personality` | ✅ PASS | 1542ms |  |
| 38 | `/personality coder` | ✅ PASS | 1529ms |  |
| 39 | `How do I reverse a string?` | ✅ PASS | 6558ms |  |
| 40 | `/personality poet` | ✅ PASS | 1533ms |  |
| 41 | `/personality none` | ✅ PASS | 1522ms |  |
| 42 | `/personality ghost` | ✅ PASS | 1521ms |  |

## Failures (detailed)

### `/tool uuid`

**Reason:** pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: Ad-hoc tools (injected per-call via SendOptions.tools): |  | • `base64` — Encode or decode a string with base64. Input { mode: "encode"|"decode" (default encode), text: required }. | • `hash` — Compute a cr

**Actual reply:**
```
Ad-hoc tools (injected per-call via SendOptions.tools):

• `base64` — Encode or decode a string with base64. Input { mode: "encode"|"decode" (default encode), text: required }.
• `hash` — Compute a cryptographic hash. Input { algorithm: md5|sha1|sha256|sha512 (default sha256), text }.
• `roll` — Roll dice. Input { count: 1..100, sides: 2..1000 }. Returns each roll + total. Example: 3d6 → { count: 3, sides: 6 }.
• `timezone` — Current local time in any IANA timezone. Input { tz: "America/Sao_Paulo" }. Defaults to UTC.
• `uuid` — Generate a fresh UUID v4. Takes no arguments.

Usage: /tool <name> <args> — e.g. /tool roll 3d6, /tool uuid, /tool hash sha256 hello.
The model only sees the named tool — no shell magic, no MCP fallback.
06:50
```

### `/goal write a one-line haiku about robots and stop when done`

**Reason:** pattern mismatch — failing: /(Status|turn|verdict).*?(completed|continue|done|failed|max turns)/ — reply head: Usage: /goal <goal description> |  | Example: /goal write a haiku about robots and stop when done |  | Drives Agent.runUntil(goal) with a judge model (openai/gpt-4o-mini). | Max 3 turns. Real-LLM only. | 06:52

**Actual reply:**
```
Usage: /goal <goal description>

Example: /goal write a haiku about robots and stop when done

Drives Agent.runUntil(goal) with a judge model (openai/gpt-4o-mini).
Max 3 turns. Real-LLM only.
06:52
```

### `/memory supermemory jazz`

**Reason:** pattern mismatch — failing: /Recalled|fact/ — reply head: Usage: /memory <provider> <topic> |  | Provider: supermemory · honcho · mem0 | Example: /memory supermemory jazz |  | Each provider is opt-in via env var (SUPERMEMORYAPIKEY / HONCHOAPIKEY / MEM0APIKEY). | 06:54

**Actual reply:**
```
Usage: /memory <provider> <topic>

Provider: supermemory · honcho · mem0
Example: /memory supermemory jazz

Each provider is opt-in via env var (SUPERMEMORYAPIKEY / HONCHOAPIKEY / MEM0APIKEY).
06:54
```
