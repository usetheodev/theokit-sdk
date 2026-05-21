# telegram-pro Dogfood — 2026-05-21T03:23:16.122Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 39 ✅ | **Fail:** 2 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 275.1s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1825ms |  |
| 2 | `/help` | ✅ PASS | 1036ms |  |
| 3 | `/me` | ✅ PASS | 1032ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 5075ms |  |
| 5 | `/recall corinthians` | ❌ FAIL | 35276ms | pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — repl |
| 6 | `/agents` | ✅ PASS | 1533ms |  |
| 7 | `/skills` | ✅ PASS | 1035ms |  |
| 8 | `/summary` | ✅ PASS | 1035ms |  |
| 9 | `/reset` | ✅ PASS | 1031ms |  |
| 10 | `/cron` | ✅ PASS | 1028ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1046ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1037ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1045ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1044ms |  |
| 15 | `/tool list` | ✅ PASS | 1043ms |  |
| 16 | `/tool uuid` | ✅ PASS | 6571ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 2541ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 2545ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 4056ms |  |
| 20 | `/batch jazz` | ✅ PASS | 2543ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 2042ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1052ms |  |
| 23 | `/notion` | ✅ PASS | 1050ms |  |
| 24 | `/stream` | ✅ PASS | 1059ms |  |
| 25 | `/stream on` | ✅ PASS | 1033ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1541ms |  |
| 27 | `/stream off` | ✅ PASS | 1026ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1051ms |  |
| 29 | `/loops` | ✅ PASS | 1533ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 2035ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 4536ms |  |
| 32 | `/pool` | ✅ PASS | 2526ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 11145ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 4558ms |  |
| 36 | `/context` | ✅ PASS | 2530ms |  |
| 37 | `/personality` | ✅ PASS | 1530ms |  |
| 38 | `/personality coder` | ✅ PASS | 1523ms |  |
| 39 | `How do I reverse a string?` | ❌ FAIL | 45361ms | timeout / no reply |
| 40 | `/personality poet` | ✅ PASS | 2026ms |  |
| 41 | `/personality none` | ✅ PASS | 1521ms |  |
| 42 | `/personality ghost` | ✅ PASS | 1524ms |  |

## Failures (detailed)

### `/recall corinthians`

**Reason:** pattern mismatch — failing: /Corinthians|time|memory|encontr|run (finished|error)|rate-limit/ — reply head: No matches found. | 00:19

**Actual reply:**
```
No matches found.
00:19
```

### `How do I reverse a string?`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
