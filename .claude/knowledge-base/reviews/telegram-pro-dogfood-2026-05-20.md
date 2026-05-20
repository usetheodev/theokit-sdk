# telegram-pro Dogfood — 2026-05-20T18:21:08.126Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 36 | **Pass:** 34 ✅ | **Fail:** 1 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 400.9s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1066ms |  |
| 2 | `/help` | ✅ PASS | 1078ms |  |
| 3 | `/me` | ✅ PASS | 1053ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 97388ms |  |
| 5 | `/recall corinthians` | ❌ FAIL | 122098ms | pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — repl |
| 6 | `/agents` | ✅ PASS | 1053ms |  |
| 7 | `/skills` | ✅ PASS | 1052ms |  |
| 8 | `/summary` | ✅ PASS | 1039ms |  |
| 9 | `/reset` | ✅ PASS | 1055ms |  |
| 10 | `/cron` | ✅ PASS | 1060ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1040ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1044ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1084ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1589ms |  |
| 15 | `/tool list` | ✅ PASS | 1055ms |  |
| 16 | `/tool uuid` | ✅ PASS | 9119ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 3594ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 2633ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 4631ms |  |
| 20 | `/batch jazz` | ✅ PASS | 2607ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 2096ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1633ms |  |
| 23 | `/notion` | ✅ PASS | 1605ms |  |
| 24 | `/stream` | ✅ PASS | 1564ms |  |
| 25 | `/stream on` | ✅ PASS | 1074ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1566ms |  |
| 27 | `/stream off` | ✅ PASS | 5646ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1649ms |  |
| 29 | `/loops` | ✅ PASS | 1113ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1075ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 3591ms |  |
| 32 | `/pool` | ✅ PASS | 1025ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 12700ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5118ms |  |
| 36 | `/context` | ✅ PASS | 1057ms |  |

## Failures (detailed)

### `/recall corinthians`

**Reason:** pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — reply head: I can only search for past conversations if you have had one with me before. Since the bot was just started, there are no past conversations to search for. | 15:17

**Actual reply:**
```
I can only search for past conversations if you have had one with me before. Since the bot was just started, there are no past conversations to search for.
15:17
```
