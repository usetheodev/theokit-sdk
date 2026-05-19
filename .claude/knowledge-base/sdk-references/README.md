# SDK References — patterns selecionados

> Curadoria de **patterns técnicos, design decisions, e lessons learned**
> extraídos de codebases de agentes maduros (Hermes Agent, OpenClaw, Mastra,
> Vercel AI SDK) **filtrados pelo escopo do `@usetheo/sdk`** — framework
> SDK Apache-2.0 do "Harness pillar" do usetheo.

## O que entra aqui

Patterns/decisões que se aplicam a **um SDK** (framework). Filtro de inclusão:

- ✅ Pattern reutilizável (atomic-write, file-lock, profile isolation, FTS5 sanitization, prompt-cache discipline)
- ✅ Failure mode evitável (compression death spiral, TOCTOU race, secret-redaction false positives, zombie locks)
- ✅ Design decision arquitetural (plugin contract shape, tool registry, error handling discipline, ABC vs interface)
- ✅ Testing discipline (change-detector ban, hermetic isolation, invariant vs snapshot)

## O que NÃO entra aqui

- ❌ Features de produto top-level (multi-platform gateway 22 plat, multi-agent kanban, voice cloning, web dashboard)
- ❌ Backends de execução específicos (Docker/Modal/Daytona) — domínio de quem CONSTRÓI com o SDK
- ❌ Surfaces UI/CLI (TUI, slash-commands) — fora de escopo SDK
- ❌ Funcionalidades que duplicariam o que vendor SDKs (Vercel AI, Mastra) já fazem bem

## Origens das fontes

- **`referencia/hermes-agent/`** — codebase Python (Nous Research, MIT, 811k LoC).
  Deep-dive em `.claude/knowledge-base/hermes-deep-dive/` é o material primário.
  Cross-reference matrix (23 patterns ↔ 16 deep-dive docs ↔ Hermes
  primary source) em [`hermes-deep-dive/INDEX.md`](../hermes-deep-dive/INDEX.md).
- **`referencia/openclaw/`** — TS monorepo (gitignored, study material).
- **`referencia/mastra/`** — TS comparable, agent framework.
- **`referencia/openai-agents-python/`** — OpenAI Agents Python SDK.
- **`referencia/pi/`** — Pi reference (origem do nosso v1.0).

## Índice (23 picks)

### Persistence & state
- [atomic-write-pattern.md](./atomic-write-pattern.md) ✅ — temp + fsync + rename canonical pattern
- [file-lock-pattern.md](./file-lock-pattern.md) ✅ — cross-process serialization (fcntl/proper-lockfile)
- [profile-isolation.md](./profile-isolation.md) ✅ — `getTheokitHome()` single getter, never hardcode paths
- [schema-versioning.md](./schema-versioning.md) ✅ — forward-only migrations, never delete user data
- [sqlite-wal-fallback.md](./sqlite-wal-fallback.md) ✅ — WAL primary, DELETE fallback for NFS/SMB/FUSE
- [fts5-sanitization.md](./fts5-sanitization.md) ✅ — 6-step sanitize (hyphens, dots, underscores, CJK trigram)

### Agent core loop
- [prompt-cache-discipline.md](./prompt-cache-discipline.md) ✅ — never alter context mid-conversation
- [tool-call-failure-recovery.md](./tool-call-failure-recovery.md) ✅ — DeepSeek/Codex repair middleware patterns
- [compression-death-spiral.md](./compression-death-spiral.md) ✅ — compression triggers → fails → infinite loop

### Plugin & extension architecture
- [plugin-contract-design.md](./plugin-contract-design.md) ✅ — narrowly-typed lifecycle hooks, not duck typing
- [tool-registry-pattern.md](./tool-registry-pattern.md) ✅ — auto-discovery + explicit toolset wiring
- [provider-as-plugin.md](./provider-as-plugin.md) ✅ — lazy discovery, last-writer-wins, conflict surfacing

### Background work
- [forked-agent-pattern.md](./forked-agent-pattern.md) ✅ — background review fork, AsyncLocalStorage whitelist
- [async-iterable-streaming.md](./async-iterable-streaming.md) ✅ — `Agent.runUntil` → `AsyncIterable<Event>` design
- [judge-call-pattern.md](./judge-call-pattern.md) ✅ — auxiliary LLM as judge for autonomous loops

### Security
- [secret-redaction-discipline.md](./secret-redaction-discipline.md) ✅ — default OFF until proven safe (v0.12-v0.13 lesson)
- [path-traversal-vectors.md](./path-traversal-vectors.md) ✅ — skill bundles, zip-slip, symlink boundaries
- [toctou-race-prevention.md](./toctou-race-prevention.md) ✅ — multiple closures, file-lock pattern

### Testing
- [testing-invariant-vs-snapshot.md](./testing-invariant-vs-snapshot.md) ✅ — change-detector ban
- [hermetic-test-isolation.md](./hermetic-test-isolation.md) ✅ — autouse fixture, `THEOKIT_HOME` tmp
- [property-based-testing.md](./property-based-testing.md) ✅ — fast-check for state machine invariants

### Error handling
- [error-context-surfacing.md](./error-context-surfacing.md) ✅ — generic "an error occurred" is banned
- [graceful-degradation.md](./graceful-degradation.md) ✅ — lazy probe for system deps (git, which, lockfile)

## Status dos docs

✅ **Complete** — 23/23 picks shipados (276KB total). Cada doc é
independente, citação-rigoroso, com TypeScript translation pronto.

## Roadmap macro — adoção dos patterns no SDK

Status reflete o que está **implementado no `@usetheo/sdk` hoje** vs o
que é proposed-but-not-wired. Auditado em 2026-05-18 contra
`packages/sdk/src/`.

| Status | Significado |
|---|---|
| ✅ DONE | Pattern wirado no SDK; documento serve como referência de manutenção |
| ⚠️ PARTIAL | Implementação parcial; gaps documentados na coluna Notes |
| ❌ PENDING | Nada implementado ainda; pattern é proposta a wirar |
| 📚 CULTURAL | Discipline humana (code review, naming), não código |

### Persistence & state (6) — ✅ persistence-state-hardening plan COMPLETED 2026-05-18

| Pattern | Status | Notes |
|---|---|---|
| [atomic-write-pattern](./atomic-write-pattern.md) | ✅ DONE | `atomicWriteJson<T>` typed helper + EC-4 auto-mkdir. 3 JSON callers migrated. |
| [file-lock-pattern](./file-lock-pattern.md) | ✅ DONE | `withFileLock` cross-process via `proper-lockfile` peer dep + EC-1 companion lockfile + cwd-mutex bridge for in-process. |
| [profile-isolation](./profile-isolation.md) | ✅ DONE | `getTheokitHome(cwd)` honours `THEOKIT_HOME` env. Vitest autouse setup isolates per-test. Lint test gates regressions. |
| [schema-versioning](./schema-versioning.md) | ✅ DONE | `migrateSchema` (SQLite) + `readVersionedJson`/`writeVersionedJson` (JSON) + EC-2 full-parsed migrate callback. Agent registry migrated. |
| [sqlite-wal-fallback](./sqlite-wal-fallback.md) | ✅ DONE | `applyWalWithFallback` wired in memory-index opens. DELETE fallback for NFS/SMB; warn-once per label. |
| [fts5-sanitization](./fts5-sanitization.md) | ✅ DONE | 6-step `sanitizeFts5Query` + `containsCjk` + EC-3 empty short-circuit at call sites. Auto-quote idempotent. |

### Agent core loop (3)

| Pattern | Status | Notes |
|---|---|---|
| [prompt-cache-discipline](./prompt-cache-discipline.md) | 📚 CULTURAL | `systemPrompt` não é `readonly` ainda; sem `invalidateCache` API |
| [tool-call-failure-recovery](./tool-call-failure-recovery.md) | ❌ PENDING | Sem `<think>` strip, sem case-insensitive match, sem type coerce |
| [compression-death-spiral](./compression-death-spiral.md) | ❌ PENDING | Sem `IterationBudget` com compression cap |

### Plugin & extension (3)

| Pattern | Status | Notes |
|---|---|---|
| [plugin-contract-design](./plugin-contract-design.md) | ❌ PENDING | Sem `Plugin` interface, sem `PluginContext`, sem hooks enum |
| [tool-registry-pattern](./tool-registry-pattern.md) | ⚠️ PARTIAL | `defineTool` (D24) existe; sem `ToolRegistry` central nem `Toolset` per-platform |
| [provider-as-plugin](./provider-as-plugin.md) | ❌ PENDING | Providers hardcoded; sem `ProviderProfile` interface, sem lazy discovery |

### Background work (3)

| Pattern | Status | Notes |
|---|---|---|
| [forked-agent-pattern](./forked-agent-pattern.md) | ❌ PENDING | Sem `forkAgent`, sem AsyncLocalStorage whitelist |
| [async-iterable-streaming](./async-iterable-streaming.md) | ⚠️ PARTIAL | `Agent.streamObject` (D39) usa pattern; `Agent.runUntil` não existe |
| [judge-call-pattern](./judge-call-pattern.md) | ❌ PENDING | Sem `judgeCall`, sem parse-failure detection |

### Security (3)

| Pattern | Status | Notes |
|---|---|---|
| [secret-redaction-discipline](./secret-redaction-discipline.md) | ❌ PENDING | `redact` mencionado em memory contexts mas não é security pattern (sem prefix list, sem env snapshot) |
| [path-traversal-vectors](./path-traversal-vectors.md) | ❌ PENDING | Sem `safePathJoin`, sem `PathTraversalError`, sem symlink guard |
| [toctou-race-prevention](./toctou-race-prevention.md) | ⚠️ PARTIAL | `cwd-mutex.ts` cobre in-process; sem CAS patterns SQLite, sem O_EXCL |

### Testing (3)

| Pattern | Status | Notes |
|---|---|---|
| [testing-invariant-vs-snapshot](./testing-invariant-vs-snapshot.md) | 📚 CULTURAL | Tests existentes não usam `toMatchSnapshot` (bom sinal); pattern já praticado |
| [hermetic-test-isolation](./hermetic-test-isolation.md) | ✅ DONE | `vitest.setup.ts` com autouse `THEOKIT_HOME` tmpdir per-test (T6.1, ADR D60). `setupFiles` wired em `vitest.config.ts`. Lint test em `tests/lint/no-hardcoded-theokit-path.test.ts` audita regressões. |
| [property-based-testing](./property-based-testing.md) | ❌ PENDING | Sem `fast-check` em deps |

### Error handling (2) — ✅ error-context-surfacing plan COMPLETED 2026-05-18

| Pattern | Status | Notes |
|---|---|---|
| [error-context-surfacing](./error-context-surfacing.md) | ✅ DONE | `ErrorMetadata` + `ErrorCode` (D65/D66) typed fields on base error class. `mapAnthropicError` + `mapOpenAICompatibleError` (D67) provider mappers. Wired in `internal/llm/anthropic.ts`, `internal/llm/openai.ts`, embedding adapter, and `fallback-client.ts` (now falls back on Auth/RateLimit too). |
| [graceful-degradation](./graceful-degradation.md) | ✅ DONE | ADR D42 (auto-detect telemetry via createRequire), D50 (lance dry-run), D55 (fail-open) todos implementados |

### Totais (2026-05-18 — pós secret-redaction-discipline)

```
✅ DONE        11 (48%)
⚠️ PARTIAL      3 (13%)
❌ PENDING      7 (30%)
📚 CULTURAL    2  (9%)
              ───
              23 (100%)
```

- **Persistence & State**: 6/6 DONE (was 5 PARTIAL / 1 PENDING at v1.2).
- **Testing**: 2/3 DONE + 1/3 CULTURAL — hermetic-isolation via T6.1; property-based-testing landed with secret-redaction adversarial suite (`fast-check`).
- **Error handling**: 2/2 DONE — both `error-context-surfacing` (D65/D66/D67) and `graceful-degradation` (D42/D50/D55) shipped.
- **Security**: 1/3 DONE — `secret-redaction-discipline` (D68-D73) shipped; `path-traversal-vectors` + `toctou-race-prevention` remain.

### Como ler isso

- **DONE** → pattern serve só como manutenção; lê para refresher
- **PARTIAL** → gaps específicos a fechar; cada doc tem seção "Onde wirar no SDK" com paths
- **PENDING** → wishlist; priorizar por dependency order (atomic-write antes de file-lock, profile-isolation antes de TUDO state-related)
- **CULTURAL** → enforce via code review; lint rules quando possível

Roadmap não-prioritizado — esse é mapa, não plano. Para plano formal de
implementação, ver `.claude/knowledge-base/plans/` (quando criado).

## Como ler isso

Cada pick-doc é independente. Use-os como **referência durante design/code review**:

- Antes de criar/modificar persistência → ler `atomic-write-pattern.md` + `file-lock-pattern.md`
- Antes de adicionar config feature → ler `profile-isolation.md`
- Antes de mudar plugin/tool API → ler `plugin-contract-design.md` + `tool-registry-pattern.md`
- Antes de escrever testes → ler `testing-invariant-vs-snapshot.md` + `hermetic-test-isolation.md`
- Code review encontrou erro silencioso → ler `error-context-surfacing.md`
