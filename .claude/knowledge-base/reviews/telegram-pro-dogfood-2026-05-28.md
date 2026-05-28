# telegram-pro Dogfood — 2026-05-28T10:44:11.927Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 48 | **Pass:** 46 ✅ | **Fail:** 1 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 272.8s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1646ms |  |
| 2 | `/help` | ✅ PASS | 1050ms |  |
| 3 | `/me` | ✅ PASS | 1048ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 9094ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 12100ms |  |
| 6 | `/agents` | ✅ PASS | 1031ms |  |
| 7 | `/skills` | ✅ PASS | 1039ms |  |
| 8 | `/summary` | ✅ PASS | 1054ms |  |
| 9 | `/reset` | ✅ PASS | 1046ms |  |
| 10 | `/cron` | ✅ PASS | 1039ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1048ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1032ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1037ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1062ms |  |
| 15 | `/tool list` | ✅ PASS | 1051ms |  |
| 16 | `/tool uuid` | ✅ PASS | 9077ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 3056ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3644ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 5584ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1554ms |  |
| 21 | `/tasks` | ✅ PASS | 1039ms |  |
| 22 | `/budget` | ✅ PASS | 1062ms |  |
| 23 | `/budget_demo Reply with the single word 'pong'.` | ✅ PASS | 2043ms |  |
| 24 | `/migrate_memory` | ✅ PASS | 1536ms |  |
| 25 | `/memory_lance` | ✅ PASS | 1064ms |  |
| 26 | `/notion` | ✅ PASS | 1126ms |  |
| 27 | `/stream` | ✅ PASS | 1077ms |  |
| 28 | `/stream on` | ✅ PASS | 1046ms |  |
| 29 | `Say jazz in one word.` | ✅ PASS | 1051ms |  |
| 30 | `/stream off` | ✅ PASS | 1051ms |  |
| 31 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1041ms |  |
| 32 | `/loops` | ✅ PASS | 1043ms |  |
| 33 | `/stop_loop all` | ✅ PASS | 1078ms |  |
| 34 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1554ms |  |
| 35 | `/pool` | ✅ PASS | 1098ms |  |
| 36 | `/memory supermemory jazz` | ✅ PASS | 24242ms |  |
| 37 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 38 | `/memory mem0 jazz` | ✅ PASS | 4551ms |  |
| 39 | `/context` | ✅ PASS | 1070ms |  |
| 40 | `/handoff_demo I was charged twice this month` | ✅ PASS | 4061ms |  |
| 41 | `/workflow_demo I was charged twice this month` | ✅ PASS | 2584ms |  |
| 42 | `/cache_demo What is the capital of France?` | ✅ PASS | 2068ms |  |
| 43 | `/personality` | ✅ PASS | 1038ms |  |
| 44 | `/personality coder` | ❌ FAIL | 8095ms | timeout / no reply |
| 45 | `How do I reverse a string?` | ✅ PASS | 17656ms |  |
| 46 | `/personality poet` | ✅ PASS | 1049ms |  |
| 47 | `/personality none` | ✅ PASS | 1565ms |  |
| 48 | `/personality ghost` | ✅ PASS | 1051ms |  |

## Failures (detailed)

### `/personality coder`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
