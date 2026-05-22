# telegram-pro Dogfood — 2026-05-22T19:26:41.340Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 43 | **Pass:** 42 ✅ | **Fail:** 0 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 226.1s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1085ms |  |
| 2 | `/help` | ✅ PASS | 2041ms |  |
| 3 | `/me` | ✅ PASS | 1519ms |  |
| 4 | `Remember: meu time é Corinthians` | ✅ PASS | 8591ms |  |
| 5 | `/recall corinthians` | ✅ PASS | 6054ms |  |
| 6 | `/agents` | ✅ PASS | 2037ms |  |
| 7 | `/skills` | ✅ PASS | 1520ms |  |
| 8 | `/summary` | ✅ PASS | 1529ms |  |
| 9 | `/reset` | ✅ PASS | 3543ms |  |
| 10 | `/cron` | ✅ PASS | 1035ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1548ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1526ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1528ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1523ms |  |
| 15 | `/tool list` | ✅ PASS | 1520ms |  |
| 16 | `/tool uuid` | ✅ PASS | 8142ms |  |
| 17 | `/tool roll 3d6` | ✅ PASS | 4101ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3076ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 6673ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1042ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1039ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1026ms |  |
| 23 | `/notion` | ✅ PASS | 1021ms |  |
| 24 | `/stream` | ✅ PASS | 1034ms |  |
| 25 | `/stream on` | ✅ PASS | 1024ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1030ms |  |
| 27 | `/stream off` | ✅ PASS | 1042ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1040ms |  |
| 29 | `/loops` | ✅ PASS | 1046ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1541ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1524ms |  |
| 32 | `/pool` | ✅ PASS | 1523ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 7574ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5578ms |  |
| 36 | `/context` | ✅ PASS | 1518ms |  |
| 37 | `/handoff_demo I was charged twice this month` | ✅ PASS | 5566ms |  |
| 38 | `/personality` | ✅ PASS | 1518ms |  |
| 39 | `/personality coder` | ✅ PASS | 1544ms |  |
| 40 | `How do I reverse a string?` | ✅ PASS | 6564ms |  |
| 41 | `/personality poet` | ✅ PASS | 1549ms |  |
| 42 | `/personality none` | ✅ PASS | 2531ms |  |
| 43 | `/personality ghost` | ✅ PASS | 1538ms |  |
