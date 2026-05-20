# Examples 100% Coverage — Final Dogfood QA — 2026-05-17

Phase 4 of the `examples-100-coverage` plan. Validates that all 5 new examples boot end-to-end as real users would experience them.

## Acceptance criteria

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | `pnpm validate` exit=0 (regression-free) | ✅ PASS | `/tmp/v12c-validate.log` exit=0 |
| 2 | Typecheck examples Pass=46/46 | ✅ PASS | `examples-typecheck-2026-05-17.md` shows `Pass=46  TscError=0` |
| 3 | `examples/mcp-oauth-notion` config-only smoke exit 0 | ✅ PASS | `node src/index.ts` printed config JSON + exit 0 |
| 4 | `examples/memory-lance` smoke exit 0 (sem Lance instalado) | ✅ PASS | `node src/index.ts` ran dry-run migration + printed Lance opt-in config + exit 0 |
| 5 | `examples/telemetry-autoinstrument` config-only smoke exit 0 | ✅ PASS | Printed supported vendors + opt-out flags + exit 0 |
| 6 | `examples/react-nextjs` `pnpm build` exit 0 | ✅ PASS | Built 10 routes (3 client pages + 3 API routes + home + layout + not-found + assistant). |
| 7 | `examples/stream-object` real-LLM smoke exit 0 | ✅ PASS | Ran against Gemini via OpenRouter; 2.1s; schema-validated FactCard object emitted via complete event |
| 8 | `tools/validate-streamobject-real-llm.mjs` continua PASS 6/6 | ✅ PASS | Re-ran; 2.3s; Great Wall of China fact card emitted |
| 9 | Zero CRITICAL issues introduzidos | ✅ PASS | No regression; all 5 new examples are additive |

## Per-example summary

### 1. `examples/stream-object/`
- **Files**: 5 (package.json, tsconfig.json, src/index.ts, README.md, .env.example)
- **LoC**: src/index.ts ~95 LoC
- **Typecheck**: ✅ PASS
- **Smoke (real-LLM with Gemini via OpenRouter)**: ✅ PASS 2.1s
- **Output**: 0 partials, finishReason=tool_use, schema-validated object

### 2. `examples/mcp-oauth-notion/`
- **Files**: 5 (package.json, tsconfig.json, src/index.ts, README.md, .env.example)
- **LoC**: src/index.ts ~65 LoC
- **Typecheck**: ✅ PASS
- **Smoke (config-only, no creds)**: ✅ PASS — printed McpServerConfig JSON, exit 0
- **README**: full setup guide for Notion integration + security notes (state CSRF, token storage, EC-14 Windows keytar fallback)

### 3. `examples/memory-lance/`
- **Files**: 4 (package.json, tsconfig.json, src/index.ts, README.md)
- **LoC**: src/index.ts ~105 LoC
- **Typecheck**: ✅ PASS
- **Smoke (without `@lancedb/lancedb`)**: ✅ PASS — seeded MEMORY.md, ran migrateSqliteToLance dry-run, printed Lance opt-in config + typed error sample, exit 0
- **EC-1 MUST FIX confirmed**: Memory API divergiu do snippet original (`Memory` é namespace com runDreamingSweep apenas, não `Memory.create()`); example pivotou para `migrateSqliteToLance` + ConfigurationError demonstration. Pattern documentado no README.

### 4. `examples/telemetry-autoinstrument/`
- **Files**: 5 (package.json, tsconfig.json, src/index.ts, README.md, .env.example)
- **LoC**: src/index.ts ~75 LoC
- **Typecheck**: ✅ PASS
- **Smoke (config-only, no creds)**: ✅ PASS — printed supported vendors + opt-out flags, exit 0
- **README**: install commands for each vendor (Langfuse/Sentry/PostHog) + privacy notes + EC-12 double-billing prevention

### 5. `examples/react-nextjs/`
- **Files**: 14 (package.json, tsconfig.json, next.config.mjs, .env.example, README.md, layout, home, 3 pages, 3 API routes, 2 lib files)
- **LoC**: ~400 LoC total across all files (each page.tsx ~70 LoC, each route.ts ~10-25 LoC)
- **Typecheck**: ✅ PASS
- **Build (`pnpm build`)**: ✅ PASS — produced 10 routes via `next build`; static pages prerendered, API routes dynamic.
- **Schema sharing (EC-2 MUST FIX)**: `lib/schemas.ts` exports single `FactCard` Zod schema; both `app/assistant/page.tsx` (client) and `app/api/assistant/route.ts` (server) import the same export. NÃO redefinido em 2 lugares.
- **Webpack config**: `next.config.mjs` configura fallback `false` para `node:*` + `better-sqlite3` + `keytar` no client bundle (SDK Node-only code não vaza pro browser).
- **README**: warnings explícitos sobre (a) `lib/get-agent.ts` server-only, (b) cold start serverless invalida cache (correctness via getOrCreate), (c) Next.js 14 pin.

## Snapshots files updated

- `.claude/knowledge-base/reviews/examples-typecheck-2026-05-17.md` — Pass=46 (era 41)
- `.claude/knowledge-base/reviews/streamobject-real-llm-2026-05-17.md` — re-PASS pós-mudanças

## Coverage matrix (final)

| # | Feature | Tem example agora? | Task |
|---|---|---|---|
| 1 | `Agent.streamObject` | ✅ stream-object | T1.1 |
| 2 | `useTheoCompletion` | ✅ react-nextjs `/completion` | T2.1 |
| 3 | `useTheoAssistant` | ✅ react-nextjs `/assistant` | T2.1 |
| 4 | `useTheoChat` + `streamTheoChat` (gap v1.1) | ✅ react-nextjs `/chat` | T2.1 |
| 5 | MCP OAuth 2.1 PKCE | ✅ mcp-oauth-notion | T1.2 |
| 6 | Auto-instrumentation telemetry | ✅ telemetry-autoinstrument | T1.4 |
| 7 | LanceDB backend | ✅ memory-lance | T1.3 |
| 8 | Migration CLI | ✅ memory-lance (chama migrateSqliteToLance) | T1.3 |
| 9 | `Agent.generateObject` (baseline) | ✅ telegram-pro | — |
| 10 | Examples README com Feature matrix | ✅ examples/README.md | T3.1 |
| 11 | Backward compat | ✅ zero examples existentes modificados | (additive) |

**11/11 gaps covered (100%)**

## Verdict

**PASS** — Plano `examples-100-coverage` totalmente implementado. Todos os 5 examples novos rodam end-to-end (typecheck + smoke + 1 real-LLM); README atualizado com Feature matrix de 18 linhas; 5 ADRs (D47-D51) lockados; `pnpm validate` continua exit=0.

Dev externo lendo `examples/` agora consegue chegar a "hello world" de qualquer feature pública sem precisar abrir `docs.md` ou tests.
