# telegram-pro Dogfood — 2026-05-21T20:05:23.664Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 30 ✅ | **Fail:** 11 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 462.2s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1560ms |  |
| 2 | `/help` | ✅ PASS | 1047ms |  |
| 3 | `/me` | ✅ PASS | 1054ms |  |
| 4 | `Remember: meu time é Corinthians` | ❌ FAIL | 15139ms | timeout / no reply |
| 5 | `/recall corinthians` | ❌ FAIL | 35168ms | timeout / no reply |
| 6 | `/agents` | ✅ PASS | 1025ms |  |
| 7 | `/skills` | ✅ PASS | 1019ms |  |
| 8 | `/summary` | ✅ PASS | 1026ms |  |
| 9 | `/reset` | ✅ PASS | 1028ms |  |
| 10 | `/cron` | ✅ PASS | 1034ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1029ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1032ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1034ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1027ms |  |
| 15 | `/tool list` | ✅ PASS | 1030ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 12103ms | timeout / no reply |
| 17 | `/tool roll 3d6` | ❌ FAIL | 12102ms | timeout / no reply |
| 18 | `/fact corinthians` | ✅ PASS | 3534ms |  |
| 19 | `/factstream jazz` | ❌ FAIL | 60299ms | pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming object... | 16:59 |
| 20 | `/batch jazz` | ✅ PASS | 1533ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1530ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1023ms |  |
| 23 | `/notion` | ✅ PASS | 1023ms |  |
| 24 | `/stream` | ✅ PASS | 1023ms |  |
| 25 | `/stream on` | ✅ PASS | 1034ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1035ms |  |
| 27 | `/stream off` | ✅ PASS | 1026ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1032ms |  |
| 29 | `/loops` | ✅ PASS | 1026ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1025ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ❌ FAIL | 120475ms | pattern mismatch — failing: /(Status|turn|verdict).*?(completed|continue|done|failed|max turns)/ — r |
| 32 | `/pool` | ✅ PASS | 1020ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 11069ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 5543ms |  |
| 36 | `/context` | ✅ PASS | 1529ms |  |
| 37 | `/personality` | ✅ PASS | 1029ms |  |
| 38 | `/personality coder` | ❌ FAIL | 8048ms | timeout / no reply |
| 39 | `How do I reverse a string?` | ❌ FAIL | 45182ms | timeout / no reply |
| 40 | `/personality poet` | ❌ FAIL | 8039ms | timeout / no reply |
| 41 | `/personality none` | ❌ FAIL | 8041ms | timeout / no reply |
| 42 | `/personality ghost` | ❌ FAIL | 8037ms | timeout / no reply |

## Failures (detailed)

### `Remember: meu time é Corinthians`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/recall corinthians`

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

**Reason:** pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming object... | 16:59

**Actual reply:**
```
 Streaming object...
16:59
```

### `/goal write a one-line haiku about robots and stop when done`

**Reason:** pattern mismatch — failing: /(Status|turn|verdict).*?(completed|continue|done|failed|max turns)/ — reply head: (run error) |  | Detail: fetch failed [agent_loop_failed] | 17:02

**Actual reply:**
```
(run error)

Detail: fetch failed [agent_loop_failed]
17:02
```

### `/personality coder`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `How do I reverse a string?`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/personality poet`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/personality none`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```

### `/personality ghost`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
