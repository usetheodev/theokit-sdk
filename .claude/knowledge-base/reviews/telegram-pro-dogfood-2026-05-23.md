# telegram-pro Dogfood — 2026-05-23T13:18:34.759Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 45 | **Pass:** 43 ✅ | **Fail:** 1 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 238.8s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1072ms |  |
| 2 | `/help` | ✅ PASS | 1575ms |  |
| 3 | `/me` | ✅ PASS | 1630ms |  |
| 4 | `Remember: meu time é Corinthians` | ❌ FAIL | 15401ms | timeout / no reply |
| 5 | `/recall corinthians` | ✅ PASS | 15186ms |  |
| 6 | `/agents` | ✅ PASS | 1696ms |  |
| 7 | `/skills` | ✅ PASS | 1212ms |  |
| 8 | `/summary` | ✅ PASS | 1107ms |  |
| 9 | `/reset` | ✅ PASS | 1762ms |  |
| 10 | `/cron` | ✅ PASS | 1099ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1714ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1567ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1093ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1055ms |  |
| 15 | `/tool list` | ✅ PASS | 1046ms |  |
| 16 | `/tool uuid` | ✅ PASS | 3065ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 5565ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3062ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 7090ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1045ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1560ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1022ms |  |
| 23 | `/notion` | ✅ PASS | 1026ms |  |
| 24 | `/stream` | ✅ PASS | 1019ms |  |
| 25 | `/stream on` | ✅ PASS | 1020ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1642ms |  |
| 27 | `/stream off` | ✅ PASS | 1119ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1706ms |  |
| 29 | `/loops` | ✅ PASS | 1087ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1638ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1662ms |  |
| 32 | `/pool` | ✅ PASS | 1679ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 8407ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5510ms |  |
| 36 | `/context` | ✅ PASS | 1702ms |  |
| 37 | `/handoff_demo I was charged twice this month` | ✅ PASS | 5087ms |  |
| 38 | `/workflow_demo I was charged twice this month` | ✅ PASS | 3050ms |  |
| 39 | `/cache_demo What is the capital of France?` | ✅ PASS | 2051ms |  |
| 40 | `/personality` | ✅ PASS | 1036ms |  |
| 41 | `/personality coder` | ✅ PASS | 1043ms |  |
| 42 | `How do I reverse a string?` | ✅ PASS | 5046ms |  |
| 43 | `/personality poet` | ✅ PASS | 1035ms |  |
| 44 | `/personality none` | ✅ PASS | 1046ms |  |
| 45 | `/personality ghost` | ✅ PASS | 1039ms |  |

## Failures (detailed)

### `Remember: meu time é Corinthians`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
