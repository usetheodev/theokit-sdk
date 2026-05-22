# telegram-pro Dogfood — 2026-05-22T21:37:25.051Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 45 | **Pass:** 43 ✅ | **Fail:** 1 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 243.9s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1542ms |  |
| 2 | `/help` | ✅ PASS | 1031ms |  |
| 3 | `/me` | ✅ PASS | 1015ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 6542ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 8059ms |  |
| 6 | `/agents` | ✅ PASS | 1528ms |  |
| 7 | `/skills` | ✅ PASS | 1019ms |  |
| 8 | `/summary` | ✅ PASS | 1017ms |  |
| 9 | `/reset` | ✅ PASS | 1028ms |  |
| 10 | `/cron` | ✅ PASS | 1010ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1011ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1019ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1019ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1019ms |  |
| 15 | `/tool list` | ✅ PASS | 1119ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 20417ms | timeout / no reply |
| 17 | `/tool roll 3d6` | ✅ PASS | 5827ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3819ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 6149ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1526ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1524ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1018ms |  |
| 23 | `/notion` | ✅ PASS | 1032ms |  |
| 24 | `/stream` | ✅ PASS | 1011ms |  |
| 25 | `/stream on` | ✅ PASS | 1017ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1520ms |  |
| 27 | `/stream off` | ✅ PASS | 1516ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1043ms |  |
| 29 | `/loops` | ✅ PASS | 1018ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1027ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1637ms |  |
| 32 | `/pool` | ✅ PASS | 1100ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 8682ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5800ms |  |
| 36 | `/context` | ✅ PASS | 1649ms |  |
| 37 | `/handoff_demo I was charged twice this month` | ✅ PASS | 5361ms |  |
| 38 | `/workflow_demo I was charged twice this month` | ✅ PASS | 3039ms |  |
| 39 | `/cache_demo What is the capital of France?` | ✅ PASS | 3664ms |  |
| 40 | `/personality` | ✅ PASS | 1109ms |  |
| 41 | `/personality coder` | ✅ PASS | 1627ms |  |
| 42 | `How do I reverse a string?` | ✅ PASS | 9146ms |  |
| 43 | `/personality poet` | ✅ PASS | 1521ms |  |
| 44 | `/personality none` | ✅ PASS | 1029ms |  |
| 45 | `/personality ghost` | ✅ PASS | 1520ms |  |

## Failures (detailed)

### `/tool uuid`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
