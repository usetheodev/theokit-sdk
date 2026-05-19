# telegram-pro Dogfood — 2026-05-19T23:28:56.282Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 30 | **Pass:** 29 ✅ | **Fail:** 1 ❌ | **Skip:** 0 ⏭️ | **Elapsed:** 191.2s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1047ms |  |
| 2 | `/help` | ✅ PASS | 1095ms |  |
| 3 | `/me` | ✅ PASS | 1036ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 5566ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 7098ms |  |
| 6 | `/agents` | ✅ PASS | 1053ms |  |
| 7 | `/skills` | ✅ PASS | 3069ms |  |
| 8 | `/summary` | ✅ PASS | 1098ms |  |
| 9 | `/reset` | ✅ PASS | 3555ms |  |
| 10 | `/cron` | ✅ PASS | 1521ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1514ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1530ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1524ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1522ms |  |
| 15 | `/tool list` | ✅ PASS | 1518ms |  |
| 16 | `/tool uuid` | ✅ PASS | 6075ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 5049ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 4043ms |  |
| 19 | `/factstream jazz` | ❌ FAIL | 35244ms | timeout / no reply |
| 20 | `/migrate_memory` | ✅ PASS | 2046ms |  |
| 21 | `/memory_lance` | ✅ PASS | 1035ms |  |
| 22 | `/notion` | ✅ PASS | 3583ms |  |
| 23 | `/stream` | ✅ PASS | 1527ms |  |
| 24 | `/stream on` | ✅ PASS | 1540ms |  |
| 25 | `Say jazz in one word.` | ✅ PASS | 1525ms |  |
| 26 | `/stream off` | ✅ PASS | 2041ms |  |
| 27 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 2535ms |  |
| 28 | `/loops` | ✅ PASS | 1561ms |  |
| 29 | `/stop_loop all` | ✅ PASS | 1043ms |  |
| 30 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 4554ms |  |

## Failures (detailed)

### `/factstream jazz`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
