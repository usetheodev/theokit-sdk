# telegram-pro Dogfood — 2026-05-19T20:48:58.520Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 30 | **Pass:** 29 ✅ | **Fail:** 1 ❌ | **Skip:** 0 ⏭️ | **Elapsed:** 244.0s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1256ms |  |
| 2 | `/help` | ✅ PASS | 1061ms |  |
| 3 | `/me` | ✅ PASS | 1047ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 94822ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 4565ms |  |
| 6 | `/agents` | ✅ PASS | 1033ms |  |
| 7 | `/skills` | ✅ PASS | 1058ms |  |
| 8 | `/summary` | ✅ PASS | 1039ms |  |
| 9 | `/reset` | ✅ PASS | 1036ms |  |
| 10 | `/cron` | ✅ PASS | 1051ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1060ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1046ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1035ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1540ms |  |
| 15 | `/tool list` | ✅ PASS | 1062ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 12113ms | pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: (run error) no result | 17:47 |
| 17 | `/tool roll 3d6` | ✅ PASS | 3044ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3039ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 5080ms |  |
| 20 | `/migrate_memory` | ✅ PASS | 2044ms |  |
| 21 | `/memory_lance` | ✅ PASS | 1055ms |  |
| 22 | `/notion` | ✅ PASS | 1040ms |  |
| 23 | `/stream` | ✅ PASS | 1039ms |  |
| 24 | `/stream on` | ✅ PASS | 1041ms |  |
| 25 | `Say jazz in one word.` | ✅ PASS | 1035ms |  |
| 26 | `/stream off` | ✅ PASS | 3548ms |  |
| 27 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1047ms |  |
| 28 | `/loops` | ✅ PASS | 1041ms |  |
| 29 | `/stop_loop all` | ✅ PASS | 1034ms |  |
| 30 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 3061ms |  |

## Failures (detailed)

### `/tool uuid`

**Reason:** pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: (run error) no result | 17:47

**Actual reply:**
```
(run error) no result
17:47
```
