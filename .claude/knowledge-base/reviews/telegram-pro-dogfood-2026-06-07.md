# telegram-pro Dogfood — 2026-06-07T13:07:34.019Z

Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.

**Total:** 48 | **Pass:** 43 ✅ | **Fail:** 4 ❌ | **Skip:** 1 ⏭️ | **Elapsed:** 311.4s

## Results

| # | Command | Status | Elapsed | Notes |
|---|---|---|---|---|
| 1 | `/start` | ✅ PASS | 1578ms |  |
| 2 | `/help` | ✅ PASS | 1050ms |  |
| 3 | `/me` | ✅ PASS | 1037ms |  |
| 4 | `Remember: meu time é Corinthians` | ❌ FAIL | 15189ms | pattern mismatch — failing: /Got it|saved|Saved|salvo|Corinthians|Remember/ — reply head: (run error |
| 5 | `/recall corinthians` | ✅ PASS | 10819ms |  |
| 6 | `/agents` | ✅ PASS | 1060ms |  |
| 7 | `/skills` | ✅ PASS | 1060ms |  |
| 8 | `/summary` | ✅ PASS | 1075ms |  |
| 9 | `/reset` | ✅ PASS | 2068ms |  |
| 10 | `/cron` | ✅ PASS | 1046ms |  |
| 11 | `/wiki tools` | ✅ PASS | 1067ms |  |
| 12 | `/wiki nonexistent-topic-xyz` | ✅ PASS | 1078ms |  |
| 13 | `/skill morning-routine` | ✅ PASS | 1039ms |  |
| 14 | `/skill ../etc/passwd` | ✅ PASS | 1046ms |  |
| 15 | `/tool list` | ✅ PASS | 1066ms |  |
| 16 | `/tool uuid` | ❌ FAIL | 20247ms | pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: Nenhum resultado encontrado sob |
| 17 | `/tool roll 3d6` | ✅ PASS | 3592ms |  |
| 18 | `/fact corinthians` | ❌ FAIL | 20247ms | pattern mismatch — failing: /Corinthians|football|club/ — reply head: Fact generation failed: Agent  |
| 19 | `/factstream jazz` | ✅ PASS | 4678ms |  |
| 20 | `/batch jazz` | ✅ PASS | 1587ms |  |
| 21 | `/tasks` | ✅ PASS | 1055ms |  |
| 22 | `/budget` | ✅ PASS | 1041ms |  |
| 23 | `/budget_demo Reply with the single word 'pong'.` | ✅ PASS | 2564ms |  |
| 24 | `/migrate_memory` | ✅ PASS | 1081ms |  |
| 25 | `/memory_lance` | ✅ PASS | 1094ms |  |
| 26 | `/notion` | ✅ PASS | 1060ms |  |
| 27 | `/stream` | ✅ PASS | 1063ms |  |
| 28 | `/stream on` | ✅ PASS | 1039ms |  |
| 29 | `Say jazz in one word.` | ✅ PASS | 1076ms |  |
| 30 | `/stream off` | ✅ PASS | 1115ms |  |
| 31 | `/loop 30s diga oi em uma palavra` | ✅ PASS | 1587ms |  |
| 32 | `/loops` | ✅ PASS | 1711ms |  |
| 33 | `/stop_loop all` | ✅ PASS | 1175ms |  |
| 34 | `/goal write a one-line haiku about robots and stop when done` | ✅ PASS | 1575ms |  |
| 35 | `/pool` | ✅ PASS | 1061ms |  |
| 36 | `/memory supermemory jazz` | ✅ PASS | 8164ms |  |
| 37 | `/memory honcho jazz` | ⏭️ SKIP | 0ms |  |
| 38 | `/memory mem0 jazz` | ✅ PASS | 5637ms |  |
| 39 | `/context` | ✅ PASS | 1616ms |  |
| 40 | `/handoff_demo I was charged twice this month` | ✅ PASS | 1552ms |  |
| 41 | `/workflow_demo I was charged twice this month` | ✅ PASS | 1574ms |  |
| 42 | `/cache_demo What is the capital of France?` | ✅ PASS | 1574ms |  |
| 43 | `/personality` | ✅ PASS | 1144ms |  |
| 44 | `/personality coder` | ✅ PASS | 1068ms |  |
| 45 | `How do I reverse a string?` | ❌ FAIL | 45329ms | pattern mismatch — failing: /```|def |function |const |return/ — reply head: (run error) |  | Detail |
| 46 | `/personality poet` | ✅ PASS | 1217ms |  |
| 47 | `/personality none` | ✅ PASS | 1107ms |  |
| 48 | `/personality ghost` | ✅ PASS | 1143ms |  |

## Failures (detailed)

### `Remember: meu time é Corinthians`

**Reason:** pattern mismatch — failing: /Got it|saved|Saved|salvo|Corinthians|Remember/ — reply head: (run error) |  | Detail: openrouter API error: unknown (HTTP 404) [openrouter_unknown] | 10:02

**Actual reply:**
```
(run error)

Detail: openrouter API error: unknown (HTTP 404) [openrouter_unknown]
10:02
```

### `/tool uuid`

**Reason:** pattern mismatch — failing: /[0-9a-f]{8}-[0-9a-f]{4}-/ — reply head: Nenhum resultado encontrado sobre "corinthians" nas conversas anteriores. | 10:03

**Actual reply:**
```
Nenhum resultado encontrado sobre "corinthians" nas conversas anteriores.
10:03
```

### `/fact corinthians`

**Reason:** pattern mismatch — failing: /Corinthians|football|club/ — reply head: Fact generation failed: Agent run failed before the model could reply: openrouter API error: unknown (HTTP 404) [openrouter_unknown] | 10:04

**Actual reply:**
```
Fact generation failed: Agent run failed before the model could reply: openrouter API error: unknown (HTTP 404) [openrouter_unknown]
10:04
```

### `How do I reverse a string?`

**Reason:** pattern mismatch — failing: /```|def |function |const |return/ — reply head: (run error) |  | Detail: openrouter API error: unknown (HTTP 404) [openrouter_unknown] | 10:06

**Actual reply:**
```
(run error)

Detail: openrouter API error: unknown (HTTP 404) [openrouter_unknown]
10:06
```
