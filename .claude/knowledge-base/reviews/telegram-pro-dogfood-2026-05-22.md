# telegram-pro Dogfood — 2026-05-22T15:36:55.039Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 42 | **Pass:** 35 ✅ | **Fail:** 6 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 358.4s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1871ms |  |
| 2 | `/help` | ✅ PASS | 1028ms |  |
| 3 | `/me` | ✅ PASS | 1051ms |  |
| 4 | `Remember: meu time é Corinthians` | ❌ FAIL | 15135ms | pattern mismatch — failing: /Got it|saved|Saved|salvo|Corinthians|Remember/ — reply head: (run error |
| 5 | `/recall corinthians` | ✅ PASS | 4047ms |  |
| 6 | `/agents` | ✅ PASS | 1021ms |  |
| 7 | `/skills` | ✅ PASS | 1028ms |  |
| 8 | `/summary` | ✅ PASS | 1045ms |  |
| 9 | `/reset` | ✅ PASS | 1030ms |  |
| 10 | `/cron` | ✅ PASS | 1048ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1041ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1041ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1046ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1030ms |  |
| 15 | `/tool list` | ✅ PASS | 1043ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 12157ms | pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: (run error) openrouter API erro |
| 17 | `/tool roll 3d6` | ❌ FAIL | 12350ms | pattern mismatch — failing: /Rolled.*3d6|Total/ — reply head: (run error) openrouter API error: auth |
| 18 | `/fact corinthians` | ❌ FAIL | 20304ms | pattern mismatch — failing: /Corinthians|football|club/ — reply head: Fact generation failed: Agent  |
| 19 | `/factstream jazz` | ❌ FAIL | 60492ms | pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming failed: Agent run failed before th |
| 20 | `/batch jazz` | ✅ PASS | 1626ms |  |
| 21 | `/migrate_memory` | ✅ PASS | 1548ms |  |
| 22 | `/memory_lance` | ✅ PASS | 1030ms |  |
| 23 | `/notion` | ✅ PASS | 1036ms |  |
| 24 | `/stream` | ✅ PASS | 1040ms |  |
| 25 | `/stream on` | ✅ PASS | 1048ms |  |
| 26 | `Say jazz in one word.` | ✅ PASS | 1040ms |  |
| 27 | `/stream off` | ✅ PASS | 1038ms |  |
| 28 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1013ms |  |
| 29 | `/loops` | ✅ PASS | 1027ms |  |
| 30 | `/stop_loop all` | ✅ PASS | 1033ms |  |
| 31 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1537ms |  |
| 32 | `/pool` | ✅ PASS | 1033ms |  |
| 33 | `/memory supermemory jazz` | ✅ PASS | 23224ms |  |
| 34 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 35 | `/memory mem0 jazz` | ✅ PASS | 6370ms |  |
| 36 | `/context` | ✅ PASS | 4467ms |  |
| 37 | `/personality` | ✅ PASS | 5493ms |  |
| 38 | `/personality coder` | ✅ PASS | 1142ms |  |
| 39 | `How do I reverse a string?` | ❌ FAIL | 47934ms | timeout / no reply |
| 40 | `/personality poet` | ✅ PASS | 4189ms |  |
| 41 | `/personality none` | ✅ PASS | 1038ms |  |
| 42 | `/personality ghost` | ✅ PASS | 1066ms |  |

## Failures (detailed)

### `Remember: meu time é Corinthians`

**Reason:** pattern mismatch — failing: /Got it|saved|Saved|salvo|Corinthians|Remember/ — reply head: (run error) |  | Detail: openrouter API error: auth_failed (HTTP 401) [agent_loop_failed] | 12:31

**Actual reply:**
```
(run error)

Detail: openrouter API error: auth_failed (HTTP 401) [agent_loop_failed]
12:31
```

### `/tool uuid`

**Reason:** pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: (run error) openrouter API error: auth_failed (HTTP 401) | 12:32

**Actual reply:**
```
(run error) openrouter API error: auth_failed (HTTP 401)
12:32
```

### `/tool roll 3d6`

**Reason:** pattern mismatch — failing: /Rolled.*3d6|Total/ — reply head: (run error) openrouter API error: auth_failed (HTTP 401) | 12:32

**Actual reply:**
```
(run error) openrouter API error: auth_failed (HTTP 401)
12:32
```

### `/fact corinthians`

**Reason:** pattern mismatch — failing: /Corinthians|football|club/ — reply head: Fact generation failed: Agent run failed before the model could reply: openrouter API error: auth_failed (HTTP 401) [agent_loop_failed] | 12:32

**Actual reply:**
```
Fact generation failed: Agent run failed before the model could reply: openrouter API error: auth_failed (HTTP 401) [agent_loop_failed]
12:32
```

### `/factstream jazz`

**Reason:** pattern mismatch — failing: /Jazz|Music/ — reply head:  Streaming failed: Agent run failed before the model could reply: openrouter API error: auth_failed (HTTP 401) [agent_loop_failed] | 12:33

**Actual reply:**
```
 Streaming failed: Agent run failed before the model could reply: openrouter API error: auth_failed (HTTP 401) [agent_loop_failed]
12:33
```

### `How do I reverse a string?`

**Reason:** timeout / no reply

**Actual reply:**
```
(empty / no reply)
```
