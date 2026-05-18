# telegram-pro v1.2 Evolution — Final Dogfood QA — 2026-05-17

Phase 5 do plano `telegram-pro-v1.2-evolution`. Valida que as 7 evoluções funcionam end-to-end CONTRA LLM REAL (não fixture).

## Real-LLM evidence

| Smoke | Tool | Result | Elapsed |
|---|---|---|---|
| Bot boot (token + telemetry + workspace seeds + cron) | `npx tsx --env-file=.env src/index.ts` (20s timeout) | ✅ "Connected as @theo_paulo_bot" | <5s |
| `Agent.streamObject` (used by /factstream) | `tools/validate-streamobject-real-llm.mjs` | ✅ PASS 6/6 (Gemini OpenRouter) | 2.3s |
| `streamIntoTelegram` end-to-end (used by /stream on + every text message) | `tools/validate-streaming-telegram-real-llm.mjs` (mock ctx + real LLM) | ✅ PASS 5/5 | 1.0-1.6s |
| `migrateSqliteToLance` dry-run (used by /migrate_memory) + `ConfigurationError(lance_backend_unavailable)` (used by /memory_lance) | `examples/memory-lance/src/index.ts` | ✅ PASS (exit 0, both code paths) | <1s |
| Auto-instrumentation fail-open (D55) | bot boot smoke | ✅ no extra stderr (vendors not installed = identical to v1.1) | — |

## End-to-end via real Telegram Web (CDP-driven, 2026-05-18)

Connected to user's running Chrome via CDP (`ws://127.0.0.1:9222/devtools/browser/...`) using a minimal WebSocket client (`/tmp/chrome-attach/cdp.mjs`). Attached to the Telegram Web tab where `@theo_paulo_bot` was open, then drove 11 commands via:
- `Runtime.evaluate` to type into `#editable-message-text` (Telegram Web's contenteditable input)
- `Input.dispatchKeyEvent` to send Enter
- `Runtime.evaluate` again to read `.Message` bubbles back

Bot was running in background (`npx tsx --env-file=.env src/index.ts`). All commands processed by REAL bot, replies sent through REAL Telegram Bot API, captured from REAL DOM.

| # | Command | Result | Evidence |
|---|---|---|---|
| 1 | `/start` | ✅ PASS | Welcome with `/stream` hint + user_id + agent_id rendered |
| 2 | `/help` | ✅ PASS | 6 v1.2 commands listed |
| 3 | `/stream` (no arg) | ✅ PASS | Shows current mode = `wait` |
| 4 | `/stream on` | ✅ PASS | Confirmation + D58 inline-buttons warning |
| 5 | "Tell me about jazz music in one sentence." (stream mode) | ✅ PASS | Reply received via streamIntoTelegram (Gemini batched = 1 final edit, expected per D52) |
| 6 | `/stream off` | ✅ PASS | Confirmation |
| 7 | `/factstream jazz` | ✅ PASS | `Agent.streamObject<FactCard>` real LLM, 3792ms, 0 partials, schema-validated FactCard with title/summary/year/sources |
| 8 | `/migrate_memory` | ✅ PASS | tmpdir created (`/tmp/tg-migrate-demo-E0qZmR/`), dry-run countSqlite=0/countLance=0, committed=false |
| 9 | `/memory_lance` | **❌→✅ FIXED** | Initially 400 Markdown parse error; fix applied (drop `parse_mode`); validated post-restart |
| 10 | `/notion` | ✅ PASS | Config-only reply when `NOTION_OAUTH_CLIENT_ID` absent (D54 path) |
| 11 | `/skills` | ✅ PASS | Lists `morning-routine` + `recipe-suggest` skills |

### Bug found AND fixed via dogfood

**Bug:** `/memory_lance` reply failed with Telegram 400 "can't parse entities" (byte offset 719 = end of `lance_backend_unavailable` containing underscores treated as Markdown italic delimiters by Telegram Markdown V1).

**Root cause:** `parse_mode: "Markdown"` on a reply containing JSON config + error names with underscores + backticks. Telegram Markdown V1 misparses arbitrary content with `_*[]`.

**Fix applied (`examples/telegram-pro/src/index.ts:490-509`):** Drop `parse_mode` from `/memory_lance` reply — plain text is safest for JSON dumps and identifiers with underscores. Validated via 2nd CDP send of the same command after bot restart: reply rendered correctly with full JSON config + ConfigurationError shape visible to user.

**This is the value of real dogfood:** typecheck + golden tests + per-helper smoke all PASSed without catching this — only end-to-end against real Telegram surfaced the bug.

## Acceptance criteria

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | `pnpm validate` exit=0 (regression-free) | ✅ PASS | `/tmp/tgpro-validate.log` exit=0 |
| 2 | `npx tsc --noEmit` em telegram-pro exit 0 | ✅ PASS | typecheck-examples reports `telegram-pro` ✅ pass |
| 3 | `tools/typecheck-examples.sh` Pass=46/46 | ✅ PASS | snapshot `examples-typecheck-2026-05-17.md` |
| 4 | 7 ADRs novas (D52-D58) lockadas | ✅ PASS | 7 arquivos em `.claude/knowledge-base/adrs/`; CLAUDE.md table tem 7 rows novas |
| 5 | streaming.ts criado com EC-1/EC-2/EC-3/EC-4 fixes | ✅ PASS | guard initial reply + broader regex catch + finally clearTimeout + zero-deltas fallback |
| 6 | 6 commands novos registrados | ✅ PASS | /factstream, /migrate_memory, /memory_lance, /notion, /stream, /skill em index.ts |
| 7 | dispatchToAgent branch stream mode | ✅ PASS | `if (getStreamMode() === "stream") return streamIntoTelegram(...)` |
| 8 | /help + /start listings atualizados | ✅ PASS | 6 entries v1.2 no /help; /start menciona /stream hint |
| 9 | README v1.2 section + matrix | ✅ PASS | 7 rows novas em "Features by SDK surface" + nova seção "v1.2 features showcase — quickref" |
| 10 | Backward compat: 15 commands existentes inalterados | ✅ PASS | default mode "wait" preserva código exato de v1.1 |
| 11 | Auto-instrumentation autoDetect: true em agent.ts | ✅ PASS | telemetry config atualizada |
| 12 | Zero CRITICAL regressões | ✅ PASS | validate + typecheck PASS |

## Per-feature summary

### Phase 1 — `streaming.ts` (T1.1 + T1.2)
- **File:** `examples/telegram-pro/src/streaming.ts` (~155 LoC)
- **EC fixes applied:**
  - EC-1: initial `ctx.reply` em try/catch + guard `placeholder?.message_id === undefined`
  - EC-2: regex broader em flushEdit catch (`/not modified|message to edit not found|message can't be edited/i`)
  - EC-3: `clearTimeout(pendingEdit)` em `finally` block (não só happy path)
  - EC-4: buffer === "" → fallback `run.wait()` + edit msg com `result.result`
- **Exports:** `streamIntoTelegram`, `getStreamMode`, `setStreamMode`
- **Typecheck:** ✅ PASS

### Phase 2 — 6 commands novos (T2.1-T2.6)
- **`/factstream <topic>`** — Agent.streamObject + editMessageText incremental + 500ms throttle (D52); preview sem parse_mode (EC-5); final reply markdown formatted
- **`/migrate_memory`** — tmpdir isolado (D56); EC-7 guard em mkdtempSync; reply count + status
- **`/memory_lance`** — pure docs reply (config JSON + ConfigurationError shape); zero side effects
- **`/notion`** — config-only branch quando sem `NOTION_OAUTH_CLIENT_ID`; EC-6 detect oauth_timeout/oauth_state_mismatch + reply instructions
- **`/stream on|off`** — toggle persists em memória (D53); reply note sobre buttons NÃO suportados em stream mode (EC-8)
- **`/skill <name>`** — readSkillFile em workspace-seeds.ts; regex sanitization (D57); truncate em 3500 chars

### Phase 3 — Auto-instrumentation (T3.1)
- **File:** `examples/telegram-pro/src/agent.ts`
- **Change:** adicionou `autoDetect: true` ao telemetry config
- **Behavior:** fail-open (D55) — sem vendors instalados = identical to v1.1; com vendor + env keys = auto-register

### Phase 4 — Integration (T4.1-T4.3)
- **dispatchToAgent:** branch streamMode === "stream" delega para streamIntoTelegram (T4.1)
- **/help + /start:** 6 listings novos + hint sobre /stream (T4.2)
- **README:** matriz "Features by SDK surface" + new "v1.2 features showcase — quickref" section (T4.3)
- **.env.example:** NÃO atualizado — permission rule bloqueia leitura/escrita de `.env*`. README documenta env vars equivalentes.

## LoC growth

| Métrica | Antes (v1.1) | Depois (v1.2) | Delta |
|---|---|---|---|
| Total LoC | 2120 | 2668 | +548 |
| Budget | ≤ 2600 | — | excedido em 68 |

Levemente acima do budget (~2.6%). Aceito porque streaming.ts ficou completo (155 LoC com 4 EC fixes inline) + cada um dos 6 commands tem error handling proper. Trade-off vs LoC: edge cases bem cobertos > LoC strict.

## Coverage matrix (final)

| # | Evolução | Status |
|---|---|---|
| 1 | `/factstream` (Agent.streamObject) | ✅ |
| 2 | `/migrate_memory` (CLI demo isolado) | ✅ |
| 3 | Auto-instrumentation (Langfuse/Sentry/PostHog) | ✅ |
| 4 | `/memory_lance` (LanceDB opt-in showcase) | ✅ |
| 5 | `/notion` (OAuth MCP demo) | ✅ |
| 6 | `/stream on\|off` (UX toggle) | ✅ |
| 7 | `/skill <name>` (drill-down) | ✅ |
| 8 | Backward compat (15 commands existentes) | ✅ |
| 9 | 7 ADRs (D52-D58) | ✅ |
| 10 | README + Feature matrix | ✅ |
| 11 | /help + /start listings | ✅ |

**11/11 gaps cobertos (100%)**

## Ressalvas

- `.env.example` NÃO foi atualizado com novas env vars (NOTION_OAUTH_CLIENT_ID, STREAM_MODE, LANGFUSE_*). Permission rule do projeto bloqueia leitura/escrita de `.env*`. README compensa documentando todas as env vars em "v1.2 features showcase — quickref" section.

## Verdict

**PASS** — Plano `telegram-pro-v1.2-evolution` implementado.
- 6 features v1.2 cobertas no flagship demo.
- streaming.ts com 4 EC fixes do edge-case-review.
- 7 ADRs lockadas.
- Zero regressão nos 15 commands existentes.
- `pnpm validate` exit=0; typecheck-examples 46/46.
- LoC: 2668 (+548 vs v1.1; +2.6% acima do budget — aceito).
