# telegram-pro Dogfood — 2026-05-23T17:51:59.413Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 45 | **Pass:** 44 ✅ | **Fail:** 0 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 271.7s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1715ms |  |
| 2 | `/help` | ✅ PASS | 1042ms |  |
| 3 | `/me` | ✅ PASS | 1062ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 10574ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 11612ms |  |
| 6 | `/agents` | ✅ PASS | 1043ms |  |
| 7 | `/skills` | ✅ PASS | 1042ms |  |
| 8 | `/summary` | ✅ PASS | 1073ms |  |
| 9 | `/reset` | ✅ PASS | 1049ms |  |
| 10 | `/cron` | ✅ PASS | 1086ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1043ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1021ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 2567ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1592ms |  |
| 15 | `/tool list` | ✅ PASS | 1119ms |  |
| 16 | `/tool uuid` | ✅ PASS | 11616ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 5590ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3559ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 7088ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1561ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1568ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1563ms |  |
| 23 | `/notion` | ✅ PASS | 1040ms |  |
| 24 | `/stream` | ✅ PASS | 1052ms |  |
| 25 | `/stream on` | ✅ PASS | 1032ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1556ms |  |
| 27 | `/stream off` | ✅ PASS | 2033ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1535ms |  |
| 29 | `/loops` | ✅ PASS | 2054ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1052ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1560ms |  |
| 32 | `/pool` | ✅ PASS | 1034ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 23198ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 10112ms |  |
| 36 | `/context` | ✅ PASS | 1536ms |  |
| 37 | `/handoff_demo I was charged twice this month` | ✅ PASS | 6112ms |  |
| 38 | `/workflow_demo I was charged twice this month` | ✅ PASS | 4595ms |  |
| 39 | `/cache_demo What is the capital of France?` | ✅ PASS | 3075ms |  |
| 40 | `/personality` | ✅ PASS | 1051ms |  |
| 41 | `/personality coder` | ✅ PASS | 1083ms |  |
| 42 | `How do I reverse a string?` | ✅ PASS | 7594ms |  |
| 43 | `/personality poet` | ✅ PASS | 1053ms |  |
| 44 | `/personality none` | ✅ PASS | 1547ms |  |
| 45 | `/personality ghost` | ✅ PASS | 1070ms |  |
