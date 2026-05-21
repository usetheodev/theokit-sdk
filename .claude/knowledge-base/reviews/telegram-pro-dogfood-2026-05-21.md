# telegram-pro Dogfood — 2026-05-21T21:35:50.830Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 35 ✅ | **Fail:** 6 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 1503.0s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1046ms |  |
| 2 | `/help` | ✅ PASS | 1059ms |  |
| 3 | `/me` | ✅ PASS | 1052ms |  |
| 4 | `Remember: meu time é Corinthians` | ❌ FAIL | 90539ms | timeout / no reply |
| 5 | `/recall corinthians` | ✅ PASS | 30691ms |  |
| 6 | `/agents` | ✅ PASS | 1028ms |  |
| 7 | `/skills` | ✅ PASS | 1020ms |  |
| 8 | `/summary` | ✅ PASS | 1027ms |  |
| 9 | `/reset` | ✅ PASS | 1028ms |  |
| 10 | `/cron` | ✅ PASS | 1039ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1035ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1028ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1025ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1031ms |  |
| 15 | `/tool list` | ✅ PASS | 1020ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 72336ms | timeout / no reply |
| 17 | `/tool roll 3d6` | ❌ FAIL | 72287ms | timeout / no reply |
| 18 | `/fact corinthians` | ✅ PASS | 3532ms |  |
| 19 | `/factstream jazz` | ❌ FAIL | 360287ms | pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming failed: Schema parse failed after  |
| 20 | `/batch jazz` | ✅ PASS | 1540ms |  |
| 21 | `/migrate_memory` | ❌ FAIL | 120324ms | pattern mismatch — failing: /migrateSqliteToLance|isolated tmpdir/ — reply head: Migration dry-run r |
| 22 | `/memory_lance` | ✅ PASS | 1032ms |  |
| 23 | `/notion` | ✅ PASS | 1026ms |  |
| 24 | `/stream` | ✅ PASS | 1036ms |  |
| 25 | `/stream on` | ✅ PASS | 1025ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1036ms |  |
| 27 | `/stream off` | ✅ PASS | 1018ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1018ms |  |
| 29 | `/loops` | ✅ PASS | 1023ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1025ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 305603ms |  |
| 32 | `/pool` | ✅ PASS | 1031ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 11611ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5562ms |  |
| 36 | `/context` | ✅ PASS | 1537ms |  |
| 37 | `/personality` | ✅ PASS | 1044ms |  |
| 38 | `/personality coder` | ✅ PASS | 1042ms |  |
| 39 | `How do I reverse a string?` | ❌ FAIL | 270516ms | timeout / no reply |
| 40 | `/personality poet` | ✅ PASS | 36655ms |  |
| 41 | `/personality none` | ✅ PASS | 1542ms |  |
| 42 | `/personality ghost` | ✅ PASS | 1022ms |  |

## Failures (detailed)

### `Remember: meu time é Corinthians`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/tool uuid`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/tool roll 3d6`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/factstream jazz`

**Reason:** pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming failed: Schema parse failed after all retries. | 18:16 | (run error) |  | Detail: fetch failed [agent_loop_failed] | 18:18 | (run error) Ollama model is not pulled. Run `ollama pull <model>` to downloa

**Actual reply:**
```
 Streaming failed: Schema parse failed after all retries.
18:16
(run error)

Detail: fetch failed [agent_loop_failed]
18:18
(run error) Ollama model is not pulled. Run `ollama pull <model>` to download it first.
18:18
(run error) Ollama model is not pulled. Run `ollama pull <model>` to download it first.
18:18
```

### `/migrate_memory`

**Reason:** pattern mismatch — failing: /migrateSqliteToLance|isolated tmpdir/ — reply head: Migration dry-run result: | • countSqlite: 0 | • countLance: 0 | • validated:  | • committed: no (dry-run) |  | For real migration of your bot's memory: |   pnpm exec theokit-migrate-memory --cwd . |  | Demo workspace 

**Actual reply:**
```
Migration dry-run result:
• countSqlite: 0
• countLance: 0
• validated: 
• committed: no (dry-run)

For real migration of your bot's memory:
  pnpm exec theokit-migrate-memory --cwd .

Demo workspace (will be GC'd): /tmp/tg-migrate-demo-tK92IJ
18:22
```

### `How do I reverse a string?`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
