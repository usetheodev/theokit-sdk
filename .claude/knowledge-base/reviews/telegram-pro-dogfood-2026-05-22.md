# telegram-pro Dogfood — 2026-05-22T12:05:36.053Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 40 ✅ | **Fail:** 1 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 245.0s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1648ms |  |
| 2 | `/help` | ✅ PASS | 1085ms |  |
| 3 | `/me` | ✅ PASS | 1060ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 11196ms |  |
| 5 | `/recall corinthians` | ❌ FAIL | 35414ms | pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — repl |
| 6 | `/agents` | ✅ PASS | 1051ms |  |
| 7 | `/skills` | ✅ PASS | 1036ms |  |
| 8 | `/summary` | ✅ PASS | 1048ms |  |
| 9 | `/reset` | ✅ PASS | 1036ms |  |
| 10 | `/cron` | ✅ PASS | 1029ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1065ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1038ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1034ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1078ms |  |
| 15 | `/tool list` | ✅ PASS | 1083ms |  |
| 16 | `/tool uuid` | ✅ PASS | 10600ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 2544ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3048ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 6625ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1530ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1558ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1039ms |  |
| 23 | `/notion` | ✅ PASS | 1046ms |  |
| 24 | `/stream` | ✅ PASS | 1058ms |  |
| 25 | `/stream on` | ✅ PASS | 1048ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1046ms |  |
| 27 | `/stream off` | ✅ PASS | 1030ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1056ms |  |
| 29 | `/loops` | ✅ PASS | 1049ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1034ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1069ms |  |
| 32 | `/pool` | ✅ PASS | 1036ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 13688ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5077ms |  |
| 36 | `/context` | ✅ PASS | 1050ms |  |
| 37 | `/personality` | ✅ PASS | 1052ms |  |
| 38 | `/personality coder` | ✅ PASS | 1051ms |  |
| 39 | `How do I reverse a string?` | ✅ PASS | 6095ms |  |
| 40 | `/personality poet` | ✅ PASS | 1032ms |  |
| 41 | `/personality none` | ✅ PASS | 1056ms |  |
| 42 | `/personality ghost` | ✅ PASS | 1057ms |  |

## Failures (detailed)

### `/recall corinthians`

**Reason:** pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — reply head: No matches found in sessions. | 09:02

**Actual reply:**
```
No matches found in sessions.
09:02
```
