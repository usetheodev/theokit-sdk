# telegram-pro Dogfood — 2026-05-18T20:29:06.787Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 25 | **Pass:** 24 ✅ | **Fail:** 1 ❌ | **Skip:** 0 ⏭️ | **Elapsed:** 100.5s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1094ms |  |
| 2 | `/help` | ✅ PASS | 1086ms |  |
| 3 | `/me` | ✅ PASS | 2553ms |  |
| 4 | `/agents` | ✅ PASS | 4062ms |  |
| 5 | `/skills` | ✅ PASS | 4028ms |  |
| 6 | `/cron` | ✅ PASS | 2026ms |  |
| 7 | `/wiki tools` | ✅ PASS | 3027ms |  |
| 8 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 2015ms |  |
| 9 | `/skill morning-routine` | ✅ PASS | 2529ms |  |
| 10 | `/skill ../etc/passwd` | ✅ PASS | 1011ms |  |
| 11 | `/tool list` | ✅ PASS | 2012ms |  |
| 12 | `/tool uuid` | ✅ PASS | 4026ms |  |
| 13 | `/tool roll 3d6` | ✅ PASS | 4031ms |  |
| 14 | `/fact corinthians` | ✅ PASS | 4024ms |  |
| 15 | `/factstream jazz` | ❌ FAIL | 35214ms | pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming failed: Schema parse failed after  |
| 16 | `/migrate_memory` | ✅ PASS | 5027ms |  |
| 17 | `/memory_lance` | ✅ PASS | 4033ms |  |
| 18 | `/notion` | ✅ PASS | 4020ms |  |
| 19 | `/stream` | ✅ PASS | 2012ms |  |
| 20 | `/stream on` | ✅ PASS | 3029ms |  |
| 21 | `Say jazz in one word.` | ✅ PASS | 2024ms |  |
| 22 | `/stream off` | ✅ PASS | 2567ms |  |
| 23 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1008ms |  |
| 24 | `/loops` | ✅ PASS | 3019ms |  |
| 25 | `/stop_loop all` | ✅ PASS | 1013ms |  |

## Failures (detailed)

### `/factstream jazz`

**Reason:** pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming failed: Schema parse failed after all retries. | 17:28

**Actual reply:**
```
 Streaming failed: Schema parse failed after all retries.
17:28
```
