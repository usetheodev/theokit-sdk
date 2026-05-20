# telegram-pro Dogfood — 2026-05-20T14:52:08.180Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 35 | **Pass:** 32 ✅ | **Fail:** 2 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 536.2s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1608ms |  |
| 2 | `/help` | ✅ PASS | 1529ms |  |
| 3 | `/me` | ✅ PASS | 1028ms |  |
| 4 | `Remember: meu time é Corinthians` | ❌ FAIL | 195635ms | timeout / no reply |
| 5 | `/recall corinthians` | ✅ PASS | 175419ms |  |
| 6 | `/agents` | ✅ PASS | 1047ms |  |
| 7 | `/skills` | ✅ PASS | 1066ms |  |
| 8 | `/summary` | ✅ PASS | 1057ms |  |
| 9 | `/reset` | ✅ PASS | 1054ms |  |
| 10 | `/cron` | ✅ PASS | 1062ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1041ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1056ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1043ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1051ms |  |
| 15 | `/tool list` | ✅ PASS | 1056ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 12127ms | timeout / no reply |
| 17 | `/tool roll 3d6` | ✅ PASS | 11161ms |  |
| 18 | `/fact corinthians` | ✅ PASS | 3058ms |  |
| 19 | `/factstream jazz` | ✅ PASS | 5153ms |  |
| 20 | `/batch jazz` | ✅ PASS | 2541ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1541ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1079ms |  |
| 23 | `/notion` | ✅ PASS | 1046ms |  |
| 24 | `/stream` | ✅ PASS | 1042ms |  |
| 25 | `/stream on` | ✅ PASS | 1042ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1067ms |  |
| 27 | `/stream off` | ✅ PASS | 1054ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1047ms |  |
| 29 | `/loops` | ✅ PASS | 1063ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1055ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 3101ms |  |
| 32 | `/pool` | ✅ PASS | 1054ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 8105ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 4577ms |  |

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
