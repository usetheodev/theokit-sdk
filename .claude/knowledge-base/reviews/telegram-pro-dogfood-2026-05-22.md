# telegram-pro Dogfood — 2026-05-22T22:42:25.611Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 45 | **Pass:** 43 ✅ | **Fail:** 1 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 368.0s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1726ms |  |
| 2 | `/help` | ✅ PASS | 3038ms |  |
| 3 | `/me` | ✅ PASS | 1048ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 10570ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 9110ms |  |
| 6 | `/agents` | ✅ PASS | 2029ms |  |
| 7 | `/skills` | ✅ PASS | 1558ms |  |
| 8 | `/summary` | ✅ PASS | 1554ms |  |
| 9 | `/reset` | ✅ PASS | 1522ms |  |
| 10 | `/cron` | ✅ PASS | 1534ms |  |
| 11 | `/wiki tools` | ✅ PASS | 2535ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1037ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1553ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1524ms |  |
| 15 | `/tool list` | ✅ PASS | 1533ms |  |
| 16 | `/tool uuid` | ✅ PASS | 11118ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 4048ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 4035ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 7081ms |  |
| 20 | `/batch jazz` | ✅ PASS | 2040ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 2027ms |  |
| 22 | `/memory_lance` | ✅ PASS | 2164ms |  |
| 23 | `/notion` | ✅ PASS | 1527ms |  |
| 24 | `/stream` | ✅ PASS | 1525ms |  |
| 25 | `/stream on` | ✅ PASS | 1558ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1525ms |  |
| 27 | `/stream off` | ✅ PASS | 2028ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1518ms |  |
| 29 | `/loops` | ✅ PASS | 2077ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 2019ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 2524ms |  |
| 32 | `/pool` | ✅ PASS | 2528ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 8114ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5562ms |  |
| 36 | `/context` | ✅ PASS | 2531ms |  |
| 37 | `/handoff_demo I was charged twice this month` | ✅ PASS | 7565ms |  |
| 38 | `/workflow_demo I was charged twice this month` | ✅ PASS | 4573ms |  |
| 39 | `/cache_demo What is the capital of France?` | ✅ PASS | 4541ms |  |
| 40 | `/personality` | ✅ PASS | 2024ms |  |
| 41 | `/personality coder` | ✅ PASS | 1523ms |  |
| 42 | `How do I reverse a string?` | ✅ PASS | 8118ms |  |
| 43 | `/personality poet` | ✅ PASS | 1026ms |  |
| 44 | `/personality none` | ✅ PASS | 1996ms |  |
| 45 | `/personality ghost` | ❌ FAIL | 103600ms | send error: Timeout: Input.dispatchKeyEvent |

## Failures (detailed)

### `/personality ghost`

**Reason:** send error: Timeout: Input.dispatchKeyEvent

**Actual reply:**
```
(empty / no reply)
```
