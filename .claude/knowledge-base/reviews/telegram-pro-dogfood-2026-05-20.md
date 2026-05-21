# telegram-pro Dogfood — 2026-05-20T21:21:57.643Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 38 ✅ | **Fail:** 3 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 248.2s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1054ms |  |
| 2 | `/help` | ✅ PASS | 1022ms |  |
| 3 | `/me` | ✅ PASS | 1042ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 4564ms |  |
| 5 | `/recall corinthians` | ❌ FAIL | 35301ms | pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — repl |
| 6 | `/agents` | ✅ PASS | 1547ms |  |
| 7 | `/skills` | ✅ PASS | 1642ms |  |
| 8 | `/summary` | ✅ PASS | 1528ms |  |
| 9 | `/reset` | ✅ PASS | 1524ms |  |
| 10 | `/cron` | ✅ PASS | 1540ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1046ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1524ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1518ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1515ms |  |
| 15 | `/tool list` | ✅ PASS | 1524ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 12099ms | timeout / no reply |
| 17 | `/tool roll 3d6` | ❌ FAIL | 12120ms | pattern mismatch — failing: /Rolled.*3d6|Total/ — reply head: ```text | UUID: 71052ff1-2b9e-4648-84b |
| 18 | `/fact corinthians` | ✅ PASS | 4596ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 5578ms |  |
| 20 | `/batch jazz` | ✅ PASS | 2561ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1549ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1051ms |  |
| 23 | `/notion` | ✅ PASS | 1035ms |  |
| 24 | `/stream` | ✅ PASS | 1061ms |  |
| 25 | `/stream on` | ✅ PASS | 1032ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1052ms |  |
| 27 | `/stream off` | ✅ PASS | 1052ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1064ms |  |
| 29 | `/loops` | ✅ PASS | 1081ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1034ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 5117ms |  |
| 32 | `/pool` | ✅ PASS | 1555ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 8118ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 6601ms |  |
| 36 | `/context` | ✅ PASS | 1577ms |  |
| 37 | `/personality` | ✅ PASS | 1032ms |  |
| 38 | `/personality coder` | ✅ PASS | 1034ms |  |
| 39 | `How do I reverse a string?` | ✅ PASS | 4572ms |  |
| 40 | `/personality poet` | ✅ PASS | 1053ms |  |
| 41 | `/personality none` | ✅ PASS | 1051ms |  |
| 42 | `/personality ghost` | ✅ PASS | 1070ms |  |

## Failures (detailed)

### `/recall corinthians`

**Reason:** pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — reply head: No matches found. | 18:18

**Actual reply:**
```
No matches found.
18:18
```

### `/tool uuid`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/tool roll 3d6`

**Reason:** pattern mismatch — failing: /Rolled.*3d6|Total/ — reply head: ```text | UUID: 71052ff1-2b9e-4648-84bb-65d984a3cb62 | ``` | 18:19

**Actual reply:**
```
```text
UUID: 71052ff1-2b9e-4648-84bb-65d984a3cb62
```
18:19
```
