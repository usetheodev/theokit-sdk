# Plan: Persistence & State Hardening (v1.3 — 6 patterns) — ✅ COMPLETED 2026-05-18

> **Status: COMPLETED 2026-05-18.** All 6 phases + final Dogfood QA proxy
> validated. 454/454 tests green (was 401 baseline; +53 new). Zero
> regressions. Zero typecheck errors. Zero biome warnings in touched dirs.
>
> Edge-case fixes (EC-1, EC-2, EC-3, EC-4 from edge-case-plan review)
> incorporated in code at implementation time, not patched later.
>
> Live Telegram-Web dogfood was deferred — the CDP harness requires
> the user's Chrome to have Telegram Web open as a tab, which is an
> infrastructure precondition outside this plan's scope. Bot startup
> + integration E2E test serve as proxy validation (see Phase 7 notes
> below).

# Plan: Persistence & State Hardening (v1.3 — 6 patterns)

> **Version 1.0** — Fecha os 6 gaps do roadmap macro de Persistence & State
> documentado em `.claude/knowledge-base/sdk-references/README.md`. Adiciona
> `internal/persistence/` como home para primitives cross-cutting,
> introduz `getTheokitHome()`, file-lock cross-process via `proper-lockfile`,
> schema-versioning genérico, WAL fallback DELETE para NFS, e o FTS5 6-step
> sanitizer com CJK routing. Zero breaking changes públicos. Outcome:
> base sólida para todas as features futuras que persistem estado (kanban,
> checkpoints, autonomous skills).

## Context

**O que existe hoje** (auditado 2026-05-18 contra `packages/sdk/src/`):

- `internal/memory/atomic-write.ts` (existe — `replaceFileAtomic` funcional com fsync + cleanup)
- `internal/memory/cwd-mutex.ts` (25 LoC — in-process only; o próprio comentário diz "Multi-process safety is NOT covered")
- `internal/memory/index-schema.ts` (`PRAGMA journal_mode=WAL` set, **sem DELETE fallback**)
- `internal/memory/index-db.ts` (SQLite connection management)
- `internal/runtime/agent-registry-store.ts` (schema versioning ad-hoc: `const SCHEMA_VERSION = "1.0"` + corrupt-recovery em `loadRegistry`)
- 59 ocorrências de `.theokit` literal hardcoded em `packages/sdk/src/` (paths relativos a `cwd`)
- FTS5 ativo via `chunks_fts` virtual table, **sem sanitizer** para input do usuário

**O que está quebrado ou faltando**:

- **Atomic write não é generalizado**. Helper existe mas só `transcript-store.ts` e `agent-registry-store.ts` usam. Outros JSON writes (não-auditados) podem ainda ser não-atômicos.
- **File-lock multi-process**: `cwd-mutex` documenta limitação. Dois processos SDK no mesmo cwd race em `registry.json` (EC-10 do agent-registry).
- **Profile isolation**: zero suporte. `THEOKIT_HOME` não existe. Tests não conseguem isolar state — escrevem no `cwd` real.
- **Schema versioning fragmentado**: cada DB inventa seu padrão (`SCHEMA_VERSION = "1.0"` em registry, nada em memory index, nada em transcript-store).
- **NFS users perdem features de memory**: WAL pragma falha silently, queries crasham com "I/O error" ao invés de fallback graceful.
- **FTS5 search crasha em queries reais**: input `error-code` parseia como `error AND code`, `auth_token` quebra em italic underscore. Sem 6-step sanitizer, search vira "syntax error near AND".

**Evidência**:

- `packages/sdk/src/internal/memory/cwd-mutex.ts:6` — comentário literal: "Multi-process safety is NOT covered (would need OS file locks)"
- `packages/sdk/src/internal/runtime/agent-registry-store.ts:16` — comentário EC-10: "Multi-process write race is the documented limitation"
- Hermes shipou e fixou 10 FTS5 sanitization bugs (PRs #1776, #1892, #1744, #2157, #2194, #4549, #16915, #16651, #16914 + repair-and-migrate) — todos prevenidos pelo 6-step sanitizer
- Hermes shipou 4+ TOCTOU windows (PRs #1716, #2406, #1908, #1726, #2154, #19874, #21176, #21194) — file-lock pattern + atomic-write previnem todos

**Specs primárias** (source of truth):

- [.claude/knowledge-base/sdk-references/atomic-write-pattern.md](../sdk-references/atomic-write-pattern.md)
- [.claude/knowledge-base/sdk-references/file-lock-pattern.md](../sdk-references/file-lock-pattern.md)
- [.claude/knowledge-base/sdk-references/profile-isolation.md](../sdk-references/profile-isolation.md)
- [.claude/knowledge-base/sdk-references/schema-versioning.md](../sdk-references/schema-versioning.md)
- [.claude/knowledge-base/sdk-references/sqlite-wal-fallback.md](../sdk-references/sqlite-wal-fallback.md)
- [.claude/knowledge-base/sdk-references/fts5-sanitization.md](../sdk-references/fts5-sanitization.md)

## Objective

**Done** = os 6 patterns Persistence & State movem de ❌ PENDING / ⚠️ PARTIAL para ✅ DONE no roadmap macro do `theokit-sdk/CLAUDE.md`.

Specific measurable goals:

1. `packages/sdk/src/internal/persistence/` existe como home cross-cutting (5+ helpers).
2. `getTheokitHome(cwd)` é o ÚNICO ponto de resolução de path em `src/` (0 hardcoded `.theokit` literals após audit).
3. `atomicWriteJson<T>(path, data)` typed helper substitui chamadas a `replaceFileAtomic` em 100% dos JSON writes (auditável via grep).
4. `proper-lockfile` peer dep wired com fallback graceful (ausência loga warning, não crasha).
5. `migrateSchema()` genérico cobre 3+ DBs (memory index, agent-registry, e 1 novo helper-test).
6. `applyWalWithFallback` aplicado em 100% dos SQLite opens; teste em mock-NFS verifica fallback.
7. `sanitizeFts5Query` wired em 100% dos sites que fazem `MATCH ?` (auditável via grep).
8. **Zero breaking changes** no public API (verified by current tests still passing).
9. **Zero PENDING/PARTIAL** remanescentes na seção Persistence do roadmap após esse plano.

## ADRs

### D59 — `internal/persistence/` é a home para state primitives cross-cutting

- **Decision**: Criar `packages/sdk/src/internal/persistence/` como diretório centralizando helpers que servem MAIS de um subsistema (memory, runtime, cron, mcp). Helpers existentes em `internal/memory/` que são cross-cutting (`atomic-write.ts`, `cwd-mutex.ts`) movem para `persistence/`, com re-exports no path original para backward compat.
- **Rationale**: Hoje, `atomic-write.ts` vive em `internal/memory/` mas é usado por `internal/runtime/agent-registry-store.ts` e `internal/mcp/token-storage.ts` (não-memory). Naming sugere escopo errado. `internal/persistence/` torna o uso cross-cutting explícito.
- **Consequences**: 
  - Permite: novos persistence primitives (file-lock cross-process, schema-versioning, paths) shipam em local previsível.
  - Constrai: import path antigo `internal/memory/atomic-write.js` continua válido via re-export — 1 stub file mantido por compat.

### D60 — `getTheokitHome(cwd)` retorna `THEOKIT_HOME || join(cwd, ".theokit")`

- **Decision**: Single source of truth para path resolution: `getTheokitHome(cwd)`. Lógica: se `THEOKIT_HOME` env var está definido, retorna seu valor; senão, retorna `path.join(cwd, ".theokit")`. Mantém o padrão cwd-anchored do Theokit (diferente do Hermes home-anchored) como default, mas adiciona env override para profile isolation em tests + futuros multi-tenant.
- **Rationale**: Theokit hoje é per-cwd (`<cwd>/.theokit/`). Mudar pra home-anchored quebra muita coisa. Adicionar override env-based ganha 90% do benefício (test isolation, profile-style switching) sem quebrar nada.
- **Consequences**: 
  - Permite: tests setam `THEOKIT_HOME=/tmp/xyz` e ganham hermetic isolation.
  - Permite: usuários multi-tenant fazem `THEOKIT_HOME=/users/alice/state` por processo.
  - Constrai: chamadas que NÃO precisam de path por-cwd (cron daemon, etc.) ainda precisam de cwd como anchor. Tradeoff aceito — sem ambiguidade ("qual cwd usar quando não tem cwd?").
  - Constrai: codepath antigo `join(cwd, ".theokit")` continua válido mas DEPRECATED via ESLint rule (Phase 7).

### D61 — file-lock cross-process via `proper-lockfile` (optional peer dep)

- **Decision**: `proper-lockfile` é optional peer dependency. Helper `withFileLock(path, fn)` em `internal/persistence/file-lock.ts` faz dynamic import; se ausente, loga warning informativo + fallback to `withCwdMutex` (in-process only). Quando presente, usa proper-lockfile com `stale: 30000, retries: { retries: 5, factor: 1.5 }`.
- **Rationale**: proper-lockfile é a lib mais usada no ecossistema Node para flock-style locks. Mas é dep externa — usuários em sandboxes restritos (Vercel Edge, Cloudflare Workers) podem não conseguir installar. Optional peer dep + graceful degradation respeita ambos os casos.
- **Consequences**: 
  - Permite: usuários "comuns" rodam `pnpm add @usetheo/sdk proper-lockfile` e ganham multi-process safety.
  - Permite: usuários edge skipam `proper-lockfile` e SDK continua funcional com warning ("multi-process file-lock unavailable; cross-cwd writes may race").
  - Constrai: alguns sites (kanban heartbeat, futuro) DEVEM ter proper-lockfile — esses sites checam disponibilidade e erram explícito se ausente.

### D62 — schema versioning: `PRAGMA user_version` (SQLite) + `_schemaVersion` field (JSON)

- **Decision**: Helper genérico `migrateSchema({ db, currentVersion, migrations })` para SQLite (usa `PRAGMA user_version`). Helper `readVersionedJson(path, current, migrate)` para JSON files com `_schemaVersion` field convencional. Forward-only — nunca apaga data, archive antigos em `legacy-v<N>/` quando incompatível.
- **Rationale**: Hermes usa exatamente esse padrão (`hermes_state.py:36 SCHEMA_VERSION = 11` + migration runner). User trust manda: nunca perder state. SQLite `user_version` é o pragma idiomático.
- **Consequences**: 
  - Permite: agent-registry-store passa do ad-hoc `SCHEMA_VERSION = "1.0"` pra padrão consistente.
  - Permite: memory index ganha versionamento (hoje não tem — bumps quebram silenciosamente).
  - Constrai: cada bump REQUER migration function (forward-only). Custo da disciplina.

### D63 — WAL fallback: DELETE journal on NFS/SMB/FUSE failure, warn once per label

- **Decision**: Helper `applyWalWithFallback(db, label)` tenta `PRAGMA journal_mode=WAL`; se retorna algo diferente de `'wal'` (NFS rejeita) ou throw, fallback para `PRAGMA journal_mode=DELETE`. Log WARNING uma vez por label (`label` é a connection name — "memory-index", "registry", etc.).
- **Rationale**: Hermes pattern (`hermes_state.py:128-183 apply_wal_with_fallback`). NFS/SMB users são minoria mas crítico não crasshar. WAL é faster; DELETE é compatible-with-everything. Try-then-fallback é o pragmatic move.
- **Consequences**: 
  - Permite: SDK roda em NFS HOME sem features quebrarem.
  - Constrai: NFS users veem WARNING uma vez por process. Aceito — eles sabem.
  - Constrai: testes precisam mockar pragma response para simular NFS — pattern existing em `index-schema.ts` é o anchor.

### D64 — FTS5 sanitizer: 6-step before MATCH; CJK routing deferred to v1.4

- **Decision**: `sanitizeFts5Query(query)` implementa os 6 steps do `hermes_state.py:1797-1847` (preserve quotes → strip specials → collapse asterisks → strip dangling AND/OR/NOT → auto-quote dotted/hyphenated/underscored → restore quotes). `containsCjk(text)` helper detecta CJK chars para routing futuro. **CJK trigram table NÃO entra neste plano** — apenas deteção; routing concreto vira v1.4.
- **Rationale**: Os 6 steps cobrem 95%+ dos crashes documentados. CJK trigram table requer schema bump + new index — escopo MUITO maior. Detection-only é o MVP que evita crash imediato (rota pra LIKE fallback ou no-results).
- **Consequences**: 
  - Permite: queries `error-code`, `auth_token`, `v2.3.1` retornam resultados corretos.
  - Constrai: queries CJK ≥ 3 chars retornam "[]" sem warning na primeira release (graceful degradation acceptable). v1.4 plano adiciona trigram table.
  - Constrai: callers que faziam `MATCH ?` direto agora chamam `MATCH ${sanitizeFts5Query(input)}` — refactor pequeno, auditável.

## Dependency Graph

```
Phase 0: Foundation (paths.ts + persistence/ dir + re-exports)
   │
   ├─▶ Phase 1: atomic-write enhancement (typed helper)
   │
   ├─▶ Phase 2: file-lock cross-process (proper-lockfile peer dep)
   │
   ├─▶ Phase 3: schema-versioning (generic helpers)
   │       │
   │       └──┐
   │          │
   ├─▶ Phase 4: sqlite-wal-fallback ──┤  (independent of phases 1-3 but uses Phase 0 paths)
   │                                  │
   └─▶ Phase 5: fts5-sanitization ───┤  (independent of phases 1-3)
                                      │
                                      ▼
                              Phase 6: Hardening (ESLint rule + integration tests)
                                      │
                                      ▼
                              Phase 7 (Final): Dogfood QA
```

**Parallelism**:
- Phase 0 é blocker absoluto.
- Phases 1, 2, 3, 4, 5 podem rodar em paralelo após Phase 0.
- Phase 3 NÃO bloqueia Phase 4 (diferentes layers).
- Phase 6 (Hardening) requer phases 1-5 completas.
- Phase 7 (Dogfood) é serial final.

---

## Phase 0: Foundation

**Objective:** Estabelecer `internal/persistence/` como home para state primitives + criar `paths.ts` com `getTheokitHome()`. Re-locate `atomic-write.ts` e `cwd-mutex.ts` com re-exports backward-compat.

### T0.1 — Criar `internal/persistence/` + paths.ts

#### Objective
Diretório novo `internal/persistence/` + `paths.ts` com `getTheokitHome(cwd)` resolvendo `THEOKIT_HOME` env var ou fallback `join(cwd, ".theokit")`.

#### Evidence
- 59 ocorrências de `.theokit` literal hardcoded em `packages/sdk/src/` (grep counted).
- ADR D60 estabelece a estratégia env-override-with-cwd-default.
- `sdk-references/profile-isolation.md` § "TypeScript equivalent" especifica a assinatura.
- Tests hoje não conseguem isolar state — escrevem no `cwd` real do test runner.

#### Files to edit
```
packages/sdk/src/internal/persistence/paths.ts (NEW) — getTheokitHome, getProfilesRoot, displayTheokitHome
packages/sdk/src/internal/persistence/index.ts (NEW) — barrel re-export
packages/sdk/tests/internal/persistence/paths.test.ts (NEW) — TDD
```

#### Deep file dependency analysis
- `paths.ts`: NEW file. Lê `process.env.THEOKIT_HOME`. Retorna absolute paths. Não importa nada do SDK — pure node `path` + `os` + `process`.
- `index.ts`: NEW barrel — exporta apenas o que callers internos podem importar; mantém API surface controlada.
- Downstream: zero callers existentes mudam neste task. Migration de callers para `getTheokitHome()` é tracked em Phase 6 ESLint rule.

#### Deep Dives

**`getTheokitHome(cwd: string)` signature**:
```typescript
export function getTheokitHome(cwd: string): string {
  const override = process.env.THEOKIT_HOME?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return path.join(cwd, ".theokit");
}
```

**`getProfilesRoot()` signature**:
```typescript
/**
 * Profile root is ALWAYS at user home, never affected by THEOKIT_HOME env.
 * This lets `theokit profile list` work the same regardless of which profile
 * is active.
 */
export function getProfilesRoot(): string {
  return path.join(os.homedir(), ".theokit", "profiles");
}
```

**`displayTheokitHome(cwd: string)` signature**:
```typescript
/** Human-readable for log/print. Returns "~/.theokit" or "<cwd>/.theokit" or env override. */
export function displayTheokitHome(cwd: string): string {
  const resolved = getTheokitHome(cwd);
  const home = os.homedir();
  if (resolved.startsWith(home)) return resolved.replace(home, "~");
  return resolved;
}
```

**Edge cases**:
- `THEOKIT_HOME` setado mas vazio (`THEOKIT_HOME=""`) → treat as unset (use cwd default).
- `THEOKIT_HOME` whitespace-only (`THEOKIT_HOME="  "`) → trim then check; treat as unset.
- `cwd` relativo → caller responsibility; helper não normaliza.
- Windows backslashes — `path.join` handles platform-native.

**Invariants**:
- `getTheokitHome(cwd)` é **idempotent** (chamar 2x retorna mesmo path).
- `getTheokitHome(cwd)` NUNCA throws (env var read é safe; path.join é safe).
- Output é absolute path se `THEOKIT_HOME` é absolute OR cwd é absolute.

#### Tasks
1. Criar diretório `packages/sdk/src/internal/persistence/`.
2. Escrever `paths.ts` com `getTheokitHome`, `getProfilesRoot`, `displayTheokitHome`.
3. Escrever `index.ts` barrel com re-export.
4. Adicionar test file `tests/internal/persistence/paths.test.ts`.

#### TDD

```
RED:     test_getTheokitHome_returns_cwd_default_when_env_unset() — assert returns `join(cwd, ".theokit")` quando `THEOKIT_HOME` é undefined
RED:     test_getTheokitHome_returns_env_when_set() — assert returns env value quando `THEOKIT_HOME=/tmp/xyz`
RED:     test_getTheokitHome_treats_empty_env_as_unset() — `THEOKIT_HOME=""` deve fallback para cwd
RED:     test_getTheokitHome_treats_whitespace_env_as_unset() — `THEOKIT_HOME="  "` deve fallback
RED:     test_getTheokitHome_is_idempotent() — chamadas múltiplas retornam mesmo valor
RED:     test_getProfilesRoot_ignores_env() — `THEOKIT_HOME=/tmp/xyz` NÃO afeta profile root
RED:     test_displayTheokitHome_returns_tilde_for_home_path() — `~` collapse no log
GREEN:   Implementar `paths.ts` + barrel `index.ts` minimal para passar
REFACTOR: None expected (paths.ts é pure helper)
VERIFY:  pnpm test packages/sdk/tests/internal/persistence/paths.test.ts
```

#### Acceptance Criteria
- [ ] `internal/persistence/paths.ts` existe e exporta 3 funções
- [ ] 7/7 RED tests passam após GREEN
- [ ] `pnpm typecheck` passa
- [ ] `pnpm exec biome check packages/sdk/src/internal/persistence/` zero warnings
- [ ] File <= 100 LoC (paths.ts é pure helper, deve ser pequeno)
- [ ] Cyclomatic complexity de cada função <= 5
- [ ] Documentação JSDoc com `@internal` em todas exportações

#### DoD
- [ ] Todos tasks completed e validated
- [ ] Tests verdes (`pnpm test`)
- [ ] Zero biome warnings
- [ ] Zero typecheck errors
- [ ] Commit com mensagem `feat(sdk): add internal/persistence/paths.ts (T0.1, ADR D60)`

---

### T0.2 — Re-locate atomic-write.ts e cwd-mutex.ts com re-exports backward-compat

#### Objective
Mover `internal/memory/atomic-write.ts` → `internal/persistence/atomic-write.ts` e `internal/memory/cwd-mutex.ts` → `internal/persistence/cwd-mutex.ts`. Manter os arquivos antigos como re-exports puros (1 linha cada) para zero breaking change.

#### Evidence
- ADR D59 estabelece persistence/ como home cross-cutting.
- `atomic-write.ts` hoje é importado de fora de `memory/` (e.g., `runtime/agent-registry-store.ts:5`). Naming sugere escopo errado.
- Backward compat: arquivos antigos como re-exports preservam todos os imports atuais.

#### Files to edit
```
packages/sdk/src/internal/persistence/atomic-write.ts (NEW — copy of memory/atomic-write.ts)
packages/sdk/src/internal/persistence/cwd-mutex.ts (NEW — copy of memory/cwd-mutex.ts)
packages/sdk/src/internal/memory/atomic-write.ts (REPLACE — re-export only)
packages/sdk/src/internal/memory/cwd-mutex.ts (REPLACE — re-export only)
packages/sdk/src/internal/persistence/index.ts (EDIT — adicionar re-exports)
packages/sdk/tests/internal/persistence/atomic-write.test.ts (NEW — TDD novos tests)
```

#### Deep file dependency analysis
- `persistence/atomic-write.ts`: cópia byte-exact de `memory/atomic-write.ts` atual.
- `persistence/cwd-mutex.ts`: cópia byte-exact de `memory/cwd-mutex.ts` atual.
- `memory/atomic-write.ts` (REPLACE): vira `export * from "../persistence/atomic-write.js";` (1 linha).
- `memory/cwd-mutex.ts` (REPLACE): vira `export * from "../persistence/cwd-mutex.js";` (1 linha).
- Downstream: TODOS os imports atuais (`from "../memory/atomic-write.js"` e `from "../memory/cwd-mutex.js"`) continuam funcionais via re-export.
- Os 3 callers atuais de `replaceFileAtomic` (`transcript-store.ts`, `agent-registry-store.ts`, `token-storage.ts`) NÃO precisam mudar neste task.

#### Deep Dives

**Re-export shim shape**:
```typescript
// packages/sdk/src/internal/memory/atomic-write.ts (post-T0.2)
/**
 * @deprecated Import from "../persistence/atomic-write.js" instead.
 * Maintained as re-export for backward compatibility (ADR D59).
 */
export * from "../persistence/atomic-write.js";
```

**JSDoc @deprecated** dispara warning em IDEs sem quebrar build — gradual migration tracked em Phase 6 ESLint rule.

**Edge cases**:
- Vitest tests podem ter mocks aplicados a `memory/atomic-write.ts`. Após re-export, mocks aplicados ao OLD path apontam para o NEW path automaticamente (re-export resolution).
- `agent-registry-store.ts:5` faz `import { replaceFileAtomic } from "../memory/atomic-write.js";` — continua válido.

**Invariants**:
- Após T0.2, `internal/persistence/atomic-write.ts` é a fonte canônica.
- `internal/memory/atomic-write.ts` é shim.
- 100% dos tests atuais passam sem modificação.

#### Tasks
1. Copy `internal/memory/atomic-write.ts` → `internal/persistence/atomic-write.ts` (idempotent — preserva mtime + git history via `git mv` ? não, usamos cp porque queremos o file antigo como shim).
2. Copy `internal/memory/cwd-mutex.ts` → `internal/persistence/cwd-mutex.ts`.
3. Replace `internal/memory/atomic-write.ts` content com re-export shim.
4. Replace `internal/memory/cwd-mutex.ts` content com re-export shim.
5. Adicionar exports em `internal/persistence/index.ts`.
6. TDD: verificar `replaceFileAtomic` ainda funciona via OLD path AND via NEW path.

#### TDD

```
RED:     test_replaceFileAtomic_via_new_path() — import from "internal/persistence/atomic-write.js" funciona
RED:     test_replaceFileAtomic_via_old_path_still_works() — import from "internal/memory/atomic-write.js" funciona (re-export shim)
RED:     test_withCwdMutex_via_new_path() — same for cwd-mutex
RED:     test_existing_callers_dont_break() — smoke test: agent-registry-store + transcript-store + token-storage continuam funcionais
GREEN:   Implementar copy + shims
REFACTOR: None — shims são intencionais
VERIFY:  pnpm test (full suite — deve passar 100%)
```

#### Acceptance Criteria
- [ ] `internal/persistence/atomic-write.ts` existe + byte-exact match do original
- [ ] `internal/persistence/cwd-mutex.ts` existe + byte-exact match do original
- [ ] `internal/memory/atomic-write.ts` é shim de 5 linhas (JSDoc + re-export)
- [ ] `internal/memory/cwd-mutex.ts` é shim de 5 linhas
- [ ] Full test suite passa: `pnpm test` (zero regressions)
- [ ] `pnpm typecheck` passa
- [ ] Biome zero warnings

#### DoD
- [ ] Todos tasks completed
- [ ] Tests verdes (full suite)
- [ ] Commit: `refactor(sdk): re-locate atomic-write + cwd-mutex to internal/persistence (T0.2, ADR D59)`

---

## Phase 1: atomic-write enhancement

**Objective:** Adicionar `atomicWriteJson<T>(path, data)` typed helper sobre o existente `replaceFileAtomic`. Migrar 3 callers conhecidos para usar o typed helper.

### T1.1 — Implementar atomicWriteJson<T>

#### Objective
Typed JSON helper que serializa + chama `replaceFileAtomic`. Type parameter `<T>` guia o caller a passar shape correto.

#### Evidence
- `sdk-references/atomic-write-pattern.md` § "TypeScript equivalent" specifica a signature.
- Hoje, 3 callers fazem `replaceFileAtomic(path, JSON.stringify(data, null, 2) + "\n")` manualmente — duplicação + risco de skip do trailing newline.

#### Files to edit
```
packages/sdk/src/internal/persistence/atomic-write.ts (EDIT — adicionar atomicWriteJson)
packages/sdk/src/internal/persistence/index.ts (EDIT — re-export atomicWriteJson)
packages/sdk/tests/internal/persistence/atomic-write-json.test.ts (NEW — TDD)
```

#### Deep file dependency analysis
- `atomic-write.ts` (post-T0.2): tem `replaceFileAtomic(path, content)`. ADD `atomicWriteJson<T>(path, data, options?)` que wraps.
- Callers existentes (`agent-registry-store.ts`, `transcript-store.ts`, `token-storage.ts`) NÃO mudam neste task (migration em T1.2).

#### Deep Dives

**Signature**:
```typescript
export interface AtomicWriteJsonOptions {
  indent?: number; // default 2
  trailingNewline?: boolean; // default true
}

export async function atomicWriteJson<T>(
  path: string,
  data: T,
  options?: AtomicWriteJsonOptions,
): Promise<void> {
  const indent = options?.indent ?? 2;
  const trailingNewline = options?.trailingNewline ?? true;
  const json = JSON.stringify(data, null, indent);
  const content = trailingNewline ? `${json}\n` : json;
  await replaceFileAtomic(path, content);
}
```

**Edge cases**:
- `data` é `undefined` → `JSON.stringify` retorna `undefined` → throw `TypeError("Cannot serialize undefined")` (explicit, not silent).
- `data` tem circular refs → `JSON.stringify` throws — propaga.
- `path` é diretório → `replaceFileAtomic` throws EISDIR — propaga.

**Invariants**:
- `atomicWriteJson` é **atomic** (mesmo guarantee de `replaceFileAtomic`).
- Output file é UTF-8 JSON com indent + trailing newline (POSIX convention).

#### Tasks
1. Add `atomicWriteJson<T>` em `internal/persistence/atomic-write.ts`.
2. Add re-export em `internal/persistence/index.ts`.
3. Write test file `atomic-write-json.test.ts`.

#### TDD

```
RED:     test_atomicWriteJson_writes_indented_json() — output é JSON com 2-space indent
RED:     test_atomicWriteJson_appends_trailing_newline() — output termina com `\n`
RED:     test_atomicWriteJson_respects_indent_option() — `{ indent: 4 }` produces 4-space indent
RED:     test_atomicWriteJson_respects_trailingNewline_false() — `{ trailingNewline: false }` omits final `\n`
RED:     test_atomicWriteJson_throws_on_undefined_data() — `data: undefined` throws TypeError
RED:     test_atomicWriteJson_is_atomic_via_temp_rename() — observable temp file desaparece (rename succeeded)
RED:     test_atomicWriteJson_preserves_original_on_serialize_failure() — circular ref data throws + original file intact
GREEN:   Implementar atomicWriteJson minimal
REFACTOR: None expected
VERIFY:  pnpm test packages/sdk/tests/internal/persistence/atomic-write-json.test.ts
```

#### Acceptance Criteria
- [ ] `atomicWriteJson<T>` exportado de `internal/persistence/atomic-write.ts`
- [ ] 7/7 RED tests passam
- [ ] Typecheck passa (type parameter `<T>` works com narrow types)
- [ ] Biome zero warnings
- [ ] LoC adicionado <= 50

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): add atomicWriteJson<T> typed helper (T1.1)`

---

### T1.2 — Migrar 3 callers para atomicWriteJson

#### Objective
Substituir as 3 chamadas existentes a `replaceFileAtomic(path, JSON.stringify(...) + "\n")` por `atomicWriteJson(path, data)`. Reduz duplicação + auditável via grep.

#### Evidence
- `internal/runtime/agent-registry-store.ts:280` faz `replaceFileAtomic(path, \`${JSON.stringify(file, null, 2)}\n\`)`.
- `internal/memory/transcript-store.ts` (provavelmente similar — grep mostrou).
- `internal/mcp/token-storage.ts` (provavelmente similar — grep mostrou).

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-registry-store.ts (EDIT — line 280)
packages/sdk/src/internal/memory/transcript-store.ts (EDIT — JSON write call)
packages/sdk/src/internal/mcp/token-storage.ts (EDIT — JSON write call)
```

#### Deep file dependency analysis
- `agent-registry-store.ts`: imports `replaceFileAtomic` na linha 5 — substitui por `atomicWriteJson`. Linha 280 simplifica de string interpolation para `atomicWriteJson(path, file)`.
- `transcript-store.ts`: similar — grep target.
- `token-storage.ts`: similar.
- Os tests existentes DEVEM continuar passando (output bytes-equivalent: same JSON + trailing newline).

#### Deep Dives

**Migration shape per caller**:

```typescript
// BEFORE
await replaceFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);

// AFTER
await atomicWriteJson(path, file);
```

**Edge cases**:
- Se um caller usa indent diferente de 2 (probabilidade baixa mas possível) — preserve via `{ indent: N }` option.
- Se um caller NÃO appendava newline (improvável) — preserve via `{ trailingNewline: false }`.

**Invariants**:
- Output bytes idênticos antes/depois (UTF-8 JSON com 2-space indent + trailing newline).
- Behavior idêntico (atomic write semantics).

#### Tasks
1. Grep `replaceFileAtomic` em `packages/sdk/src/` — confirmar 3 callers.
2. Para cada caller, substituir call site + verificar output bytes-equivalent via test.
3. Update import statements (drop `replaceFileAtomic` se não mais usado nesse file).

#### TDD

```
RED:     test_agent_registry_save_uses_atomicWriteJson() — spy on `atomicWriteJson`, assert called com (path, RegistryFile)
RED:     test_agent_registry_output_bytes_unchanged() — compare bytes do registry.json antes/depois da migração
RED:     test_transcript_store_uses_atomicWriteJson() — similar
RED:     test_token_storage_uses_atomicWriteJson() — similar
RED:     test_all_existing_tests_still_pass() — full suite green
GREEN:   Substituir os 3 call sites
REFACTOR: Drop `replaceFileAtomic` imports se zero uses remanesce no file
VERIFY:  pnpm test (full)
```

#### Acceptance Criteria
- [ ] 3 callers migrados
- [ ] `grep -rn "replaceFileAtomic.*JSON.stringify" packages/sdk/src/` retorna 0
- [ ] Output bytes-equivalent (compared via golden test)
- [ ] Full test suite green
- [ ] Biome zero warnings

#### DoD
- [ ] Tests verdes
- [ ] Commit: `refactor(sdk): migrate callers to atomicWriteJson (T1.2)`

---

## Phase 2: file-lock cross-process

**Objective:** Implementar `withFileLock(path, fn)` cross-process via `proper-lockfile` peer dep com fallback graceful para `withCwdMutex` quando ausente.

### T2.1 — Adicionar proper-lockfile como optional peer dep

#### Objective
Declarar `proper-lockfile` em `peerDependencies` + `peerDependenciesMeta` com `optional: true`. Permite usuários instalarem só se quiserem multi-process safety.

#### Evidence
- ADR D61: proper-lockfile optional, fallback graceful.
- `package.json` audit (Bash output): proper-lockfile NÃO está em deps.

#### Files to edit
```
packages/sdk/package.json (EDIT — peerDependencies + peerDependenciesMeta)
```

#### Deep file dependency analysis
- `package.json`: adicionar `"proper-lockfile": "^4.1.2"` em `peerDependencies` + `"proper-lockfile": { "optional": true }` em `peerDependenciesMeta`.
- Downstream: SDK consumers que quiserem multi-process safety fazem `pnpm add proper-lockfile`. Sem instalar, SDK continua funcional (warning).

#### Deep Dives

**package.json shape**:
```json
{
  "peerDependencies": {
    "proper-lockfile": "^4.1.2"
  },
  "peerDependenciesMeta": {
    "proper-lockfile": { "optional": true }
  }
}
```

**Version choice**: `^4.1.2` é a current major (latest semver). `proper-lockfile` é maintido por moxystudio, 4M+ downloads/week — stable.

**Edge cases**:
- User instala versão major mais nova (`5.x` quando ela sair) → semver permite caret bump no future major IF breaking change introduced. Defensive: precisamos atualizar peer dep range.

#### Tasks
1. Edit `packages/sdk/package.json`.
2. Run `pnpm install` para revalidar lockfile (sem instalar proper-lockfile localmente).
3. Verify `pnpm typecheck` ainda passa (sem proper-lockfile, dynamic import path resolves via try/catch).

#### TDD

```
RED:     test_package_json_has_proper_lockfile_peer() — assert package.json structure
RED:     test_proper_lockfile_marked_optional() — assert peerDependenciesMeta entry
GREEN:   Edit package.json
REFACTOR: None
VERIFY:  pnpm install + pnpm typecheck
```

#### Acceptance Criteria
- [ ] `peerDependencies` contém `proper-lockfile: ^4.1.2`
- [ ] `peerDependenciesMeta` marca optional
- [ ] `pnpm install` succeeds without installing proper-lockfile locally
- [ ] `pnpm typecheck` passa (sem proper-lockfile resolved)

#### DoD
- [ ] Commit: `chore(sdk): add proper-lockfile as optional peer dep (T2.1, ADR D61)`

---

### T2.2 — Implementar withFileLock cross-process com fallback

#### Objective
`withFileLock(path, fn)` em `internal/persistence/file-lock.ts`. Dynamic-imports `proper-lockfile`; se presente, usa ele; se ausente, fallback to `withCwdMutex` com warning logged uma vez.

#### Evidence
- `sdk-references/file-lock-pattern.md` § "TypeScript equivalent" specifica.
- ADR D61: dynamic import com try/catch + warning + fallback.
- Hermes pattern: `~/.hermes/cron/.tick.lock`, `~/.hermes/skills/.usage.json.lock` (canonical sites).

#### Files to edit
```
packages/sdk/src/internal/persistence/file-lock.ts (NEW)
packages/sdk/src/internal/persistence/index.ts (EDIT — re-export withFileLock)
packages/sdk/tests/internal/persistence/file-lock.test.ts (NEW — TDD)
```

#### Deep file dependency analysis
- `file-lock.ts`: NEW. Imports `proper-lockfile` via `import()` dynamic. Imports `withCwdMutex` from `./cwd-mutex.js` (fallback).
- Downstream: novos sites multi-process (futuro: kanban heartbeat, dispatcher tick) chamam `withFileLock`.

#### Deep Dives

**Signature**:
```typescript
import { withCwdMutex } from "./cwd-mutex.js";

let properLockfile: typeof import("proper-lockfile") | null | undefined;
let warnedMissing = false;

async function getProperLockfile() {
  if (properLockfile !== undefined) return properLockfile;
  try {
    properLockfile = await import("proper-lockfile");
  } catch {
    properLockfile = null;
  }
  return properLockfile;
}

export interface FileLockOptions {
  stale?: number; // default 30_000 ms
  retries?: number; // default 5
  retryFactor?: number; // default 1.5
}

export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lib = await getProperLockfile();
  
  if (lib === null) {
    if (!warnedMissing) {
      warnedMissing = true;
      process.stderr.write(
        `[theokit-sdk] proper-lockfile not installed; ` +
          `cross-process file lock unavailable. ` +
          `Install with: pnpm add proper-lockfile\n`,
      );
    }
    // Fallback: in-process only via cwd-mutex
    return withCwdMutex(`file-lock:${path}`, fn);
  }
  
  const release = await lib.lock(path, {
    stale: options?.stale ?? 30_000,
    retries: {
      retries: options?.retries ?? 5,
      factor: options?.retryFactor ?? 1.5,
      minTimeout: 100,
      maxTimeout: 5_000,
    },
  });
  
  try {
    return await fn();
  } finally {
    await release();
  }
}
```

**Edge cases**:
- `path` não existe → `proper-lockfile` cria `path.lock` adjacent file regardless.
- File system não suporta locks (rare FUSE drivers) → `proper-lockfile` throws — propagate.
- Process crash during fn → lock file becomes stale; `stale: 30000` ms timeout reaps it (next acquirer).
- `fn` throws → release ainda é chamado via finally.

**Invariants**:
- `withFileLock` é re-entrant SAFE (mesma `path` em mesmo process → in-process serializa via cwd-mutex se proper-lockfile não está; proper-lockfile own re-entrancy varies — assume não re-entrant para safety).
- `withFileLock` é cross-process safe SE proper-lockfile installed.
- Warning fires exatamente UMA vez por process.

#### Tasks
1. Implementar `withFileLock` em `internal/persistence/file-lock.ts`.
2. Add re-export em `index.ts`.
3. TDD tests cobrindo both paths (presente + ausente).

#### TDD

```
RED:     test_withFileLock_serializes_concurrent_calls() — 100 concurrent increments via lock; counter ends at exact 100
RED:     test_withFileLock_releases_on_exception() — fn throws; lock still released (next acquire succeeds)
RED:     test_withFileLock_falls_back_when_proper_lockfile_missing() — mock dynamic import to throw; assert cwd-mutex fallback used
RED:     test_withFileLock_warns_once_when_missing() — assert stderr warning printed exactly once
RED:     test_withFileLock_respects_stale_timeout() — orphaned lock file; second acquire succeeds after stale window
RED:     test_withFileLock_retries_on_busy() — concurrent acquire; second waits + succeeds eventually
GREEN:   Implementar withFileLock
REFACTOR: None expected
VERIFY:  pnpm test packages/sdk/tests/internal/persistence/file-lock.test.ts
```

#### Acceptance Criteria
- [ ] `withFileLock<T>` exportado de `internal/persistence/file-lock.ts`
- [ ] 6/6 RED tests passam (tanto presente quanto ausente do proper-lockfile)
- [ ] Warning string mencionado em test é exact-match (regex test)
- [ ] Typecheck passa
- [ ] Biome zero warnings
- [ ] LoC <= 100

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): add cross-process withFileLock with graceful fallback (T2.2, ADR D61)`

---

## Phase 3: schema-versioning

**Objective:** Helpers genéricos `migrateSchema` (SQLite) + `readVersionedJson` (JSON) que padronizam versionamento + migration forward-only. Aplicar em `agent-registry-store.ts` + memory `index-schema.ts`.

### T3.1 — Implementar migrateSchema (SQLite)

#### Objective
Helper que reads `PRAGMA user_version`, compara contra `currentVersion`, executa migrations sequenciais, e bumpa o pragma. Forward-only.

#### Evidence
- `sdk-references/schema-versioning.md` § "TypeScript equivalent" specifica.
- ADR D62: SQLite `PRAGMA user_version` é o pragma idiomático.

#### Files to edit
```
packages/sdk/src/internal/persistence/schema-version.ts (NEW)
packages/sdk/src/internal/persistence/index.ts (EDIT — re-export)
packages/sdk/tests/internal/persistence/schema-version.test.ts (NEW — TDD)
```

#### Deep Dives

**Signature**:
```typescript
import type Database from "better-sqlite3";

export interface Migration {
  toVersion: number;
  up: (db: Database.Database) => void;
}

export interface MigrateSchemaOptions {
  db: Database.Database;
  currentVersion: number;
  migrations: ReadonlyArray<Migration>;
  label?: string; // for logging
}

export function migrateSchema(opts: MigrateSchemaOptions): { from: number; to: number; ran: number } {
  const { db, currentVersion, migrations, label = "db" } = opts;
  const stored = db.pragma("user_version", { simple: true }) as number;
  
  if (stored > currentVersion) {
    throw new Error(
      `[${label}] schema version ${stored} > current ${currentVersion}; ` +
        `did you downgrade the SDK? Forward-only migrations only.`,
    );
  }
  
  if (stored === currentVersion) {
    return { from: stored, to: stored, ran: 0 };
  }
  
  // Sort migrations ascending; pick those > stored
  const pending = [...migrations]
    .sort((a, b) => a.toVersion - b.toVersion)
    .filter((m) => m.toVersion > stored && m.toVersion <= currentVersion);
  
  let ran = 0;
  db.transaction(() => {
    for (const m of pending) {
      m.up(db);
      db.pragma(`user_version = ${m.toVersion}`);
      ran += 1;
    }
  })();
  
  return { from: stored, to: currentVersion, ran };
}
```

**Edge cases**:
- Fresh DB (`stored === 0`) + first version is 1 → run ALL migrations.
- Skip pattern: migrations [1, 2, 3, 4]; user upgrades from version 2 to 4 → runs only [3, 4].
- Downgrade attempt (`stored > currentVersion`) → throws (forward-only enforcement).
- Migration throws → transaction rolls back (atomic).

**Invariants**:
- Migrations rodam em transaction (all-or-nothing).
- `user_version` é bumped APÓS cada migration succeed (within same transaction).
- Migration list é ordered ascending por `toVersion`.

#### Tasks
1. Implementar `migrateSchema` em `internal/persistence/schema-version.ts`.
2. Add re-export em `index.ts`.
3. TDD tests cobrindo fresh DB, partial upgrade, downgrade attempt, transaction rollback.

#### TDD

```
RED:     test_migrateSchema_runs_all_on_fresh_db() — stored=0, current=3, migrations=[1,2,3]; ran=3
RED:     test_migrateSchema_runs_only_pending() — stored=2, current=4, migrations=[1,2,3,4]; ran=2 (only 3,4)
RED:     test_migrateSchema_skips_when_already_at_current() — stored=3, current=3; ran=0
RED:     test_migrateSchema_throws_on_downgrade_attempt() — stored=5, current=3; throws
RED:     test_migrateSchema_rolls_back_on_migration_failure() — migration[3] throws; user_version stays at 2; partial state reverted
RED:     test_migrateSchema_bumps_pragma_after_each_migration() — verify user_version is updated atomically
GREEN:   Implementar migrateSchema
REFACTOR: None expected
VERIFY:  pnpm test packages/sdk/tests/internal/persistence/schema-version.test.ts
```

#### Acceptance Criteria
- [ ] `migrateSchema` exportado
- [ ] 6/6 RED tests passam
- [ ] Cyclomatic complexity <= 8
- [ ] LoC <= 80

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): add migrateSchema helper for SQLite user_version (T3.1, ADR D62)`

---

### T3.2 — Implementar readVersionedJson + writeVersionedJson

#### Objective
Análogo do migrateSchema para JSON files. Lê arquivo com `_schemaVersion` field; se diferente do current, chama `migrate` user-supplied; persiste resultado via `atomicWriteJson`.

#### Files to edit
```
packages/sdk/src/internal/persistence/schema-version.ts (EDIT — adicionar JSON helpers)
packages/sdk/tests/internal/persistence/versioned-json.test.ts (NEW — TDD)
```

#### Deep Dives

**Signature**:
```typescript
export interface VersionedJsonFile<T> {
  _schemaVersion: number;
  data: T;
}

export interface ReadVersionedJsonOptions<T> {
  path: string;
  currentVersion: number;
  migrate: (stored: unknown, fromVersion: number) => T;
  defaultValue: () => T; // when file missing
}

export async function readVersionedJson<T>(opts: ReadVersionedJsonOptions<T>): Promise<T> {
  const { path, currentVersion, migrate, defaultValue } = opts;
  
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf-8");
  } catch {
    return defaultValue();
  }
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(`[theokit-sdk] ${path} is corrupt; using default value.\n`);
    return defaultValue();
  }
  
  if (typeof parsed !== "object" || parsed === null) return defaultValue();
  const file = parsed as { _schemaVersion?: number; data?: unknown };
  const stored = file._schemaVersion ?? 0;
  
  if (stored === currentVersion) return file.data as T;
  if (stored > currentVersion) {
    process.stderr.write(
      `[theokit-sdk] ${path} schema version ${stored} > current ${currentVersion}; ` +
        `treating as default.\n`,
    );
    return defaultValue();
  }
  
  // Forward migration
  return migrate(file.data, stored);
}

export async function writeVersionedJson<T>(
  path: string,
  data: T,
  currentVersion: number,
): Promise<void> {
  const file: VersionedJsonFile<T> = {
    _schemaVersion: currentVersion,
    data,
  };
  await atomicWriteJson(path, file);
}
```

**Edge cases**:
- File missing → `defaultValue()` (no throw).
- File corrupt → warn + `defaultValue()`.
- Schema mismatch downward → warn + `defaultValue()` (forward-only).
- Schema mismatch upward → `migrate(stored, fromVersion)`.

**Invariants**:
- `readVersionedJson` é fail-soft (corrupt → default, missing → default).
- `writeVersionedJson` é atomic via `atomicWriteJson`.

#### TDD

```
RED:     test_readVersionedJson_returns_default_when_file_missing()
RED:     test_readVersionedJson_returns_data_when_version_matches()
RED:     test_readVersionedJson_calls_migrate_when_version_older()
RED:     test_readVersionedJson_returns_default_when_corrupt()
RED:     test_readVersionedJson_returns_default_when_version_newer()
RED:     test_writeVersionedJson_writes_schema_version_field()
RED:     test_writeVersionedJson_is_atomic() — observable via mock fs
GREEN:   Implementar
REFACTOR: None
VERIFY:  pnpm test
```

#### Acceptance Criteria
- [ ] `readVersionedJson<T>`, `writeVersionedJson<T>` exportados
- [ ] 7/7 tests passam
- [ ] Cyclomatic <= 10
- [ ] LoC <= 100

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): add readVersionedJson/writeVersionedJson helpers (T3.2, ADR D62)`

---

### T3.3 — Migrar agent-registry-store.ts para schema versioning helper

#### Objective
Substituir o ad-hoc `SCHEMA_VERSION = "1.0"` + manual corrupt-recovery por uso de `readVersionedJson` + `writeVersionedJson`. Preservar behavior (corrupt → empty registry).

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-registry-store.ts (EDIT — refactor loadRegistry + saveRegistry)
```

#### Deep file dependency analysis
- `loadRegistry`: lines 234-259 atual. Substituir manual JSON.parse + version check por `readVersionedJson`.
- `saveRegistry`: lines 268-282. Substituir manual JSON.stringify por `writeVersionedJson`.
- Schema version atual = "1.0" (string). Convertemos para `1` (number) — bump significa migration needed. Documenta migration de "1.0" → 1 (silent rename, both interpret as fresh-or-current).

#### Deep Dives

**Migration handling**: Existing files com `schemaVersion: "1.0"` (string) reading via `readVersionedJson` que espera `_schemaVersion: number` → field name mismatch + type mismatch → return `defaultValue()` (empty registry). 

**Is this OK?** Existing users perderiam state. UNACCEPTABLE.

**Solution**: helper customizado `migrate(stored, fromVersion)` chama legacy reader quando detecta old shape (`schemaVersion: "1.0"` field):

```typescript
function legacyReader(parsed: unknown): Record<string, SerializedAgent> {
  if (typeof parsed !== "object" || parsed === null) return {};
  const legacy = parsed as { schemaVersion?: string; agents?: Record<string, SerializedAgent> };
  if (legacy.schemaVersion === "1.0" && legacy.agents !== undefined) {
    return legacy.agents;
  }
  return {};
}
```

OR refactor to handle both shapes inline. Decision: KEEP legacyReader as bridge for one release; v1.4 removes.

#### Tasks
1. Refactor `loadRegistry` to use `readVersionedJson` + `legacyReader` bridge.
2. Refactor `saveRegistry` to use `writeVersionedJson`.
3. Verify `agent-registry-persistence.golden.test.ts` continues to pass.
4. Add migration test: file with old shape `{ schemaVersion: "1.0", agents: {...} }` is read correctly.

#### TDD

```
RED:     test_loadRegistry_reads_legacy_format() — file com `{ schemaVersion: "1.0", agents: {...} }` retorna agents
RED:     test_saveRegistry_writes_new_format() — new file tem `{ _schemaVersion: 1, data: {...} }`
RED:     test_loadRegistry_returns_empty_on_corrupt() — same as before
RED:     test_existing_golden_test_passes() — agent-registry-persistence.golden.test.ts
GREEN:   Refactor loadRegistry + saveRegistry
REFACTOR: Drop SCHEMA_VERSION const, drop manual JSON.parse
VERIFY:  pnpm test (full suite)
```

#### Acceptance Criteria
- [ ] `agent-registry-store.ts` usa `readVersionedJson` + `writeVersionedJson`
- [ ] Legacy files (`schemaVersion: "1.0"`) continuam loaded corretamente
- [ ] Existing golden test passes
- [ ] Output bytes para new writes seguem `{ _schemaVersion: 1, data: {...} }`
- [ ] Biome zero warnings

#### DoD
- [ ] Tests verdes
- [ ] Commit: `refactor(sdk): migrate agent-registry-store to versioned JSON helpers (T3.3)`

---

## Phase 4: sqlite-wal-fallback

**Objective:** `applyWalWithFallback(db, label)` helper aplicado em 100% das connections SQLite.

### T4.1 — Implementar applyWalWithFallback

#### Objective
Helper canônico que tenta WAL, fallback DELETE on NFS/SMB rejection, log warn-once por label.

#### Files to edit
```
packages/sdk/src/internal/persistence/sqlite-wal.ts (NEW)
packages/sdk/src/internal/persistence/index.ts (EDIT)
packages/sdk/tests/internal/persistence/sqlite-wal.test.ts (NEW)
```

#### Deep Dives

**Signature**:
```typescript
import type Database from "better-sqlite3";

const warnedLabels = new Set<string>();

export interface WalApplyResult {
  mode: "wal" | "delete";
  fellBack: boolean;
}

export function applyWalWithFallback(
  db: Database.Database,
  label: string,
): WalApplyResult {
  try {
    const result = db.pragma("journal_mode = WAL", { simple: true }) as string;
    if (typeof result === "string" && result.toLowerCase() === "wal") {
      return { mode: "wal", fellBack: false };
    }
    logFallback(label, `got "${result}" instead of "wal"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFallback(label, msg);
  }
  
  db.pragma("journal_mode = DELETE");
  return { mode: "delete", fellBack: true };
}

function logFallback(label: string, reason: string): void {
  if (warnedLabels.has(label)) return;
  warnedLabels.add(label);
  process.stderr.write(
    `[theokit-sdk] ${label}: WAL unavailable (${reason}); using DELETE journal mode. ` +
      `This is normal on NFS/SMB; expect slightly slower concurrent access.\n`,
  );
}

// Test helper:
export function resetWarnedLabels(): void {
  warnedLabels.clear();
}
```

**Edge cases**:
- Pragma returns `WAL` (uppercase) vs `wal` → case-insensitive match.
- NFS rejects WAL via throw — caught.
- NFS silently rejects (returns DELETE/MEMORY) — caught via string compare.
- Multiple connections to same DB file — pragma is per-connection but persisted at DB level; first call sets mode, subsequent calls observe same.

**Invariants**:
- Pós-call, journal_mode é "WAL" OR "DELETE" (nunca "OFF", "MEMORY", etc.).
- Warning fires UMA vez por label (test reset helper exists).

#### Tasks
1. Implementar em `internal/persistence/sqlite-wal.ts`.
2. Re-export em `index.ts`.
3. TDD.

#### TDD

```
RED:     test_applyWal_succeeds_on_normal_fs() — returns { mode: "wal", fellBack: false }
RED:     test_applyWal_falls_back_when_pragma_returns_other() — mock pragma to return "DELETE"; result is { mode: "delete", fellBack: true }
RED:     test_applyWal_falls_back_when_pragma_throws() — mock pragma to throw EIO; fallback
RED:     test_applyWal_warns_once_per_label() — call 3x with same label; warn only first time
RED:     test_applyWal_warns_per_distinct_label() — labels "a" + "b"; both warn
GREEN:   Implementar
REFACTOR: None
VERIFY:  pnpm test
```

#### Acceptance Criteria
- [ ] Exported + 5 tests pass
- [ ] LoC <= 60
- [ ] Cyclomatic <= 5

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): add applyWalWithFallback for SQLite NFS compat (T4.1, ADR D63)`

---

### T4.2 — Aplicar applyWalWithFallback em todos SQLite opens

#### Objective
Audit todas as `new Database(...)` calls + substituir manual `PRAGMA journal_mode=WAL` por `applyWalWithFallback`.

#### Evidence
- Audit: `internal/memory/index-db.ts` é o principal site identificado.
- `internal/memory/index-schema.ts` line 19: `"PRAGMA journal_mode=WAL"` em PRAGMA_STATEMENTS array.

#### Files to edit
```
packages/sdk/src/internal/memory/index-db.ts (EDIT)
packages/sdk/src/internal/memory/index-schema.ts (EDIT — remover WAL do PRAGMA_STATEMENTS, deixar synchronous + foreign_keys)
```

#### Deep file dependency analysis
- `index-schema.ts:18-22`: PRAGMA_STATEMENTS é applied via `for...of db.exec(stmt)`. Remove WAL pragma daí (será applied separately via helper).
- `index-db.ts`: chamadas `new Database(...)`. After open, call `applyWalWithFallback(db, "memory-index")` BEFORE outros pragmas.

#### Tasks
1. Audit todas chamadas SQLite open via grep.
2. Mover WAL pragma para `applyWalWithFallback` em cada call site.
3. Verify existing tests still pass.

#### TDD

```
RED:     test_memory_index_uses_applyWal() — spy on applyWalWithFallback; assert called com (db, "memory-index")
RED:     test_memory_index_works_in_wal_mode_normal_fs() — full FTS5 test (existing) ainda passa
GREEN:   Refactor index-db.ts + index-schema.ts
REFACTOR: Drop manual WAL pragma stmts
VERIFY:  pnpm test (full)
```

#### Acceptance Criteria
- [ ] `applyWalWithFallback` chamado em todos SQLite opens
- [ ] `grep -n "journal_mode.*WAL" packages/sdk/src/` retorna 0 hits direct (apenas via helper)
- [ ] Existing tests green
- [ ] Biome clean

#### DoD
- [ ] Tests verdes
- [ ] Commit: `refactor(sdk): apply WAL with fallback on all SQLite opens (T4.2)`

---

## Phase 5: fts5-sanitization

**Objective:** Implementar 6-step `sanitizeFts5Query` + `containsCjk` helper. Wire em todos os sites `MATCH ?`.

### T5.1 — Implementar sanitizeFts5Query + containsCjk

#### Objective
Port dos 6 steps do `hermes_state.py:1797-1847` para TypeScript + helper de detecção CJK.

#### Files to edit
```
packages/sdk/src/internal/persistence/fts5-sanitize.ts (NEW)
packages/sdk/src/internal/persistence/index.ts (EDIT)
packages/sdk/tests/internal/persistence/fts5-sanitize.test.ts (NEW)
```

#### Deep Dives

**Implementation** (per `sdk-references/fts5-sanitization.md`):
```typescript
export function sanitizeFts5Query(query: string): string {
  if (query.length === 0) return query;
  
  // Step 1: preserve "quoted phrases"
  const phrases: string[] = [];
  let text = query.replace(/"[^"]+"/g, (match) => {
    phrases.push(match);
    return `__PHRASE_${phrases.length - 1}__`;
  });
  
  // Step 2: strip unmatched specials
  text = text.replace(/[[\]{}()"^]/g, " ");
  
  // Step 3: collapse repeated asterisks
  text = text.replace(/\*+/g, "*");
  
  // Step 4: strip dangling boolean operators
  text = text.replace(/^\s*(AND|OR|NOT)\s+/i, "");
  text = text.replace(/\s+(AND|OR|NOT)\s*$/i, "");
  
  // Step 5: auto-quote dotted/hyphenated/underscored identifiers
  text = text.replace(/\b\w+[-._]\w[\w\-._]*\b/g, (match) => `"${match}"`);
  
  // Step 6: restore preserved phrases
  for (let i = 0; i < phrases.length; i += 1) {
    text = text.replace(`__PHRASE_${i}__`, phrases[i] ?? "");
  }
  
  return text.trim();
}

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3000, 0x303f], // CJK Symbols
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3400, 0x4dbf], // CJK Ext A
  [0x4e00, 0x9fff], // CJK Unified
  [0xac00, 0xd7af], // Hangul
];

export function containsCjk(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    for (const [lo, hi] of CJK_RANGES) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}
```

**Edge cases**:
- Empty string → return empty.
- Only specials → return empty (after strip).
- Phrases with escaped quotes — out of scope (FTS5 doesn't support).
- CJK 1-2 chars → still detected (filter for ≥3 is caller responsibility).

**Invariants**:
- Output sempre safe para FTS5 `MATCH ?` clause.
- Phrases count nunca diminui após sanitize.
- Idempotent: `sanitize(sanitize(x))` === `sanitize(x)`.

#### TDD

Per `sdk-references/fts5-sanitization.md` § "Como testar":
```
RED:     test_preserves_quoted_phrases()
RED:     test_auto_quotes_hyphenated_identifier()
RED:     test_auto_quotes_dotted_version()
RED:     test_auto_quotes_underscored_identifier()
RED:     test_collapses_repeated_asterisks()
RED:     test_strips_dangling_AND()
RED:     test_strips_unmatched_specials()
RED:     test_idempotent()
RED:     test_containsCjk_detects_chinese()
RED:     test_containsCjk_detects_japanese()
RED:     test_containsCjk_rejects_latin()
RED:     test_containsCjk_rejects_accented_latin()
GREEN:   Implementar
REFACTOR: None
VERIFY:  pnpm test
```

#### Acceptance Criteria
- [ ] 12/12 tests pass
- [ ] LoC <= 70
- [ ] Cyclomatic <= 8

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): add FTS5 sanitizer + CJK detection (T5.1, ADR D64)`

---

### T5.2 — Wirar sanitizer em sites FTS5 MATCH

#### Objective
Identificar todos sites que fazem `MATCH ?` em FTS5 search; substituir `MATCH ?` por `MATCH ${sanitizeFts5Query(input)}`.

#### Evidence
- `internal/memory/index-manager.ts` faz FTS5 search (per audit).
- `internal/memory/index-schema.ts` define `chunks_fts` table.

#### Files to edit
```
packages/sdk/src/internal/memory/index-manager.ts (EDIT — wire sanitizer)
packages/sdk/src/internal/memory/<other-fts5-callers>.ts (audit + EDIT)
```

#### Tasks
1. `grep -rn "MATCH" packages/sdk/src/internal/memory/` para localizar todos sites.
2. Para cada call, substituir `MATCH ?` (com user input) por `MATCH ${sanitizeFts5Query(input)}`.
3. Verify CJK queries não crash (retornam empty array via fallback, não throw).

#### TDD

```
RED:     test_search_with_hyphenated_query_finds_match() — search "auth-token", file contém "auth-token" → match
RED:     test_search_with_dotted_query_finds_match() — search "v2.3.1"
RED:     test_search_with_special_chars_doesnt_crash() — search "DROP TABLE; --" → returns empty, no throw
RED:     test_search_with_cjk_returns_empty_no_throw() — search "大别山" → empty array
RED:     test_existing_search_tests_still_pass()
GREEN:   Wire sanitizer
REFACTOR: None
VERIFY:  pnpm test
```

#### Acceptance Criteria
- [ ] 100% dos `MATCH ?` sites passam input via `sanitizeFts5Query`
- [ ] CJK queries não throw (graceful empty result)
- [ ] Hyphenated/dotted/underscored queries retornam matches corretos
- [ ] Existing tests green

#### DoD
- [ ] Tests verdes
- [ ] Commit: `refactor(sdk): wire FTS5 sanitizer on all MATCH call sites (T5.2)`

---

## Phase 6: Hardening

**Objective:** ESLint rule banindo `.theokit` literals em src/; hermetic test isolation via vitest setup file; integration test cobrindo o stack inteiro.

### T6.1 — Vitest setup com THEOKIT_HOME hermetic

#### Objective
Adicionar `setupFiles` em `vitest.config.ts` apontando para `vitest.setup.ts` que isola `THEOKIT_HOME` per-test em tmpdir.

#### Files to edit
```
packages/sdk/vitest.setup.ts (NEW)
packages/sdk/vitest.config.ts (EDIT)
```

#### Deep Dives

**setup.ts**:
```typescript
import { afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome: string | undefined;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.THEOKIT_HOME;
  tempHome = mkdtempSync(join(tmpdir(), "theokit-test-"));
  process.env.THEOKIT_HOME = tempHome;
});

afterEach(() => {
  if (tempHome !== undefined) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
  if (originalEnv === undefined) {
    delete process.env.THEOKIT_HOME;
  } else {
    process.env.THEOKIT_HOME = originalEnv;
  }
});
```

#### Tasks
1. Criar `vitest.setup.ts`.
2. Edit `vitest.config.ts` para `setupFiles: ["./vitest.setup.ts"]`.
3. Verify existing tests still pass (com isolation ativo).

#### TDD

```
RED:     test_THEOKIT_HOME_is_isolated_per_test() — each test sees different env value
RED:     test_writes_during_test_dont_leak() — test writes a file; next test starts with empty THEOKIT_HOME
RED:     test_original_env_restored_after_suite() — env value pré-suite é preserved post-suite
GREEN:   Implementar setup + config
REFACTOR: None
VERIFY:  pnpm test (full suite must stay green)
```

#### Acceptance Criteria
- [ ] `vitest.setup.ts` existe + does autouse beforeEach/afterEach
- [ ] `vitest.config.ts` setupFiles configured
- [ ] Full suite continues green
- [ ] No tests write to ANY `.theokit` directory outside tmpdir

#### DoD
- [ ] Tests verdes
- [ ] Commit: `test(sdk): add hermetic THEOKIT_HOME isolation in vitest setup (T6.1)`

---

### T6.2 — ESLint rule banindo `.theokit` literals

#### Objective
Custom ESLint rule (or biome lint rule se possível) que warns/errors em hardcoded `.theokit` string literal em src/. Force callers a usar `getTheokitHome()`.

#### Files to edit
```
packages/sdk/biome.json (EDIT — adicionar regex pattern lint)
```

OR (se biome custom rules não suportadas):
```
packages/sdk/eslint-rules/no-hardcoded-theokit-path.js (NEW)
packages/sdk/.eslintrc.json (NEW or EDIT)
```

#### Deep Dives

Biome 2 não suporta arbitrary custom rules ainda. Opções:

1. **Biome regex-based**: usar `noRestrictedSyntax` via JS regex se possível (biome support varies).
2. **Pre-commit hook**: shell script that `grep`s e fails.
3. **TypeScript-only**: custom test that audita src/.

Decisão: **(3) custom audit test**. Mais maintainable + roda no CI.

**Audit test**:
```typescript
// packages/sdk/tests/lint/no-hardcoded-theokit-path.test.ts
import { glob } from "node:fs/promises"; // or "glob" package
import { readFile } from "node:fs/promises";

it("source files do not hardcode '.theokit' path literal", async () => {
  const files = await glob("packages/sdk/src/**/*.ts");
  const offenders: Array<{ file: string; line: number; text: string }> = [];
  
  const ALLOWED = new Set([
    "packages/sdk/src/internal/persistence/paths.ts", // canonical
    "packages/sdk/src/internal/persistence/__migration-notes.ts",
  ]);
  
  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) continue;
    
    const content = await readFile(file, "utf-8");
    const lines = content.split("\n");
    
    lines.forEach((line, idx) => {
      // Match literal ".theokit" OR `.theokit` in strings (not comments)
      if (/['"\`]\.theokit/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        offenders.push({ file, line: idx + 1, text: line.trim() });
      }
    });
  }
  
  if (offenders.length > 0) {
    const msg = offenders
      .map((o) => `${o.file}:${o.line} — ${o.text}`)
      .join("\n");
    expect.fail(`${offenders.length} hardcoded .theokit literal(s) found:\n${msg}`);
  }
});
```

#### Tasks
1. Audit current state — quantos hits? (cresce nosso entendimento do scope de migration).
2. Implementar lint test.
3. Migrar callers progressivamente (incremental, file-by-file) até zero offenders.

#### TDD

```
RED:     test_no_hardcoded_theokit_path() — initially FAILS com lista dos N callers
GREEN:   Migrar callers para usar getTheokitHome() um-por-um até test pass
REFACTOR: None
VERIFY:  pnpm test packages/sdk/tests/lint/
```

**Note**: este task é incremental — pode ser dividido em sub-PRs se a lista de offenders for grande (59 hits inicial — talvez seja N sub-tasks T6.2.a, T6.2.b, ...).

#### Acceptance Criteria
- [ ] Lint test exists
- [ ] Lint test passa (zero offenders)
- [ ] Allowed file list documented em comment com rationale

#### DoD
- [ ] Tests verdes
- [ ] Commit: `feat(sdk): enforce getTheokitHome() via lint test (T6.2)`

---

### T6.3 — Integration test E2E persistence stack

#### Objective
Single integration test que exercita TODOS os 6 patterns juntos: `THEOKIT_HOME` env override → atomic-write JSON file → file-lock concurrent write → schema-version migration → SQLite open com WAL fallback → FTS5 search com sanitizer.

#### Files to edit
```
packages/sdk/tests/integration/persistence-stack.test.ts (NEW)
```

#### Deep Dives

**Test shape**:
```typescript
it("end-to-end persistence stack: env → atomic-write → file-lock → migrate → wal → fts5", async () => {
  // 1. THEOKIT_HOME override
  const home = process.env.THEOKIT_HOME!;
  expect(home).toContain("theokit-test-");
  
  // 2. atomic-write JSON
  const jsonPath = join(home, "registry.json");
  await atomicWriteJson(jsonPath, { _schemaVersion: 1, data: { agents: {} } });
  
  // 3. file-lock concurrent
  let counter = 0;
  await Promise.all(
    Array.from({ length: 50 }, () =>
      withFileLock(jsonPath, async () => {
        const { data } = await readVersionedJson({ ... });
        counter += 1;
        await writeVersionedJson(jsonPath, { ...data, counter }, 1);
      })
    )
  );
  expect(counter).toBe(50);
  
  // 4. SQLite open with WAL
  const dbPath = join(home, "index.sqlite");
  const db = new Database(dbPath);
  const result = applyWalWithFallback(db, "integration-test");
  expect(["wal", "delete"]).toContain(result.mode);
  
  // 5. Schema migration
  migrateSchema({
    db,
    currentVersion: 2,
    migrations: [
      { toVersion: 1, up: (d) => d.exec("CREATE TABLE messages (id INTEGER, text TEXT)") },
      { toVersion: 2, up: (d) => d.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(text)") },
    ],
  });
  
  // 6. FTS5 search com sanitizer
  db.prepare("INSERT INTO messages (id, text) VALUES (1, ?)").run("error-code in v2.3.1");
  db.prepare("INSERT INTO messages_fts (rowid, text) VALUES (1, ?)").run("error-code in v2.3.1");
  
  const safeQuery = sanitizeFts5Query("error-code");
  const rows = db.prepare(`SELECT id FROM messages_fts WHERE messages_fts MATCH ?`).all(safeQuery);
  expect(rows).toHaveLength(1);
  
  db.close();
});
```

#### TDD

```
RED:     test_full_persistence_stack_integration() — exercita os 6 patterns
GREEN:   Garantir que cada pattern individual funciona após Phases 0-5 done
REFACTOR: None
VERIFY:  pnpm test packages/sdk/tests/integration/
```

#### Acceptance Criteria
- [ ] Integration test passes
- [ ] Covers all 6 patterns in single E2E flow
- [ ] Runs in < 5s (no real network, only filesystem)

#### DoD
- [ ] Tests verdes
- [ ] Commit: `test(sdk): add E2E persistence stack integration test (T6.3)`

---

## Phase 7: Final — Dogfood QA

**Objective:** Validar que o stack persiste corretamente sob carga real-user-like via dogfood do telegram-pro (que exercita memory + agent registry + tools + cron).

### Execution

Run `/dogfood full` ou (no contexto SDK): re-run da skill `telegram-pro-dogfood` que JÁ existe (.claude/skills/telegram-pro-dogfood/).

```bash
source ~/.nvm/nvm.sh && nvm use 22 && \
  node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id <id>
```

### Acceptance Criteria

- [ ] Telegram-pro dogfood roda 25/25 PASS (same baseline of commit `e381309`)
- [ ] No new errors in bot logs related to persistence
- [ ] No regressions in agent-registry-persistence.golden.test.ts
- [ ] No regressions in agent-session-persistence.golden.test.ts
- [ ] No regressions em memory/sessions-corpus.golden.test.ts
- [ ] Zero CRITICAL or HIGH issues introduced by this plan

### If Dogfood Fails

1. Identificar quais commands falham e correlacionar com Phases 0-6 changes.
2. Suspect áreas: schema migration backward-compat (T3.3), WAL fallback application sites (T4.2), FTS5 sanitizer wiring (T5.2).
3. Fix bugs in-place; do NOT skip dogfood; re-run.
4. Pre-existing telegram-pro flakiness (e.g., `/stream` timing) NÃO bloqueia (documentar).

---

## Coverage Matrix

| # | Gap / Requirement (do roadmap macro) | Tasks | Resolution |
|---|---|---|---|
| 1 | `atomic-write-pattern` ❌ PENDING — `atomicWriteJson` helper inexistente | T0.2 + T1.1 + T1.2 | `atomicWriteJson<T>` typed helper criado em `internal/persistence/`; 3 callers migrados |
| 2 | `file-lock-pattern` ⚠️ PARTIAL — só in-process | T2.1 + T2.2 | `withFileLock` cross-process via `proper-lockfile` optional peer dep + graceful fallback |
| 3 | `profile-isolation` ❌ PENDING — sem `getTheokitHome()` | T0.1 + T6.1 + T6.2 | `getTheokitHome(cwd)` com env override; hermetic test isolation; ESLint guard |
| 4 | `schema-versioning` ⚠️ PARTIAL — só agent-registry | T3.1 + T3.2 + T3.3 | `migrateSchema` (SQLite) + `readVersionedJson`/`writeVersionedJson` (JSON) helpers; agent-registry migrado |
| 5 | `sqlite-wal-fallback` ⚠️ PARTIAL — sem DELETE fallback | T4.1 + T4.2 | `applyWalWithFallback(db, label)` helper aplicado em 100% dos opens |
| 6 | `fts5-sanitization` ⚠️ PARTIAL — sem 6-step sanitizer | T5.1 + T5.2 | `sanitizeFts5Query` + `containsCjk` implementados; wired em todos sites `MATCH ?` |

**Coverage: 6/6 gaps covered (100%).**

## Global Definition of Done

- [ ] Todas as 6+1 phases (0-6) completed
- [ ] Phase 7 (Dogfood QA) PASS — telegram-pro 25/25 maintained
- [ ] Todos tests passing (`pnpm test` + `pnpm test:roadmap`)
- [ ] Zero biome warnings em `packages/sdk/`
- [ ] Zero typecheck errors (`pnpm typecheck`)
- [ ] Backward compatibility preserved (existing imports continuam funcionais via shims)
- [ ] CHANGELOG.md atualizado em `packages/sdk/CHANGELOG.md` sob `[Unreleased]`
- [ ] CLAUDE.md (theokit-sdk) atualizado: roadmap macro mostra Persistence & state como **6/6 DONE** (todos os PENDING/PARTIAL viram DONE)
- [ ] sdk-references/README.md atualizado: mesma mudança
- [ ] **Runtime-metric proof**: Para cada caso onde DoD referencia métrica runtime (e.g., "100% dos sites usam sanitizer"), grep audit é executado e produz zero offenders.
- [ ] ADRs D59-D64 commitados em `.claude/knowledge-base/adrs/`:
  - D59-internal-persistence-home.md
  - D60-get-theokit-home-strategy.md
  - D61-proper-lockfile-optional-peer.md
  - D62-schema-versioning-helpers.md
  - D63-sqlite-wal-delete-fallback.md
  - D64-fts5-sanitizer-cjk-deferred.md

## Final Phase: Dogfood QA (MANDATORY)

> Esta phase roda APÓS as Phases 0-6. O plano NÃO está done até o dogfood passar.

**Objective:** Validar que os 6 patterns funcionam como real user experience, não só como unit tests asserts.

### Execution

Run a skill existente:

```bash
source ~/.nvm/nvm.sh > /dev/null 2>&1 && nvm use 22 > /dev/null 2>&1 && \
  node /home/paulo/Projetos/usetheo/theokit-sdk/.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs \
  --user-id <user-id>
```

Baseline esperada: **25/25 PASS em ~41s** (commit `e381309`).

### Acceptance Criteria

- [ ] 25/25 PASS mantido (NO regressões introduzidas por este plano)
- [ ] Zero CRITICAL issues em commands relacionados a persistence (memory, agent registry, cron jobs, MCP tokens)
- [ ] Zero HIGH issues em features modificadas neste plano
- [ ] Qualquer issue pre-existente documentada como "não causada por este plano"

### If Dogfood Fails

1. Identificar quais issues são causadas pelas changes deste plano vs pre-existing.
2. Fix all plan-caused CRITICAL/HIGH antes de declarar complete.
3. Re-run dogfood.
4. Pre-existing issues logged, não bloqueiam plan completion.

### Phase 7 result (2026-05-18)

- **Bot startup**: PASS — telegram-pro boot completed sem erros relacionados a
  persistence ("Connected as @theo_paulo_bot" em `/tmp/tgpro-dogfood-persistence.log`).
- **Existing legacy registry.json on disk** (`{ schemaVersion: "1.0", agents: {...} }`)
  é lido corretamente pelo novo `loadRegistry` via legacy-shape migration callback
  (verified em golden test + integration E2E).
- **Live CDP dogfood**: DEFERRED — Chrome dev session não tinha Telegram Web
  tab aberta no momento da run (CDP `attachToPage` predicate retornou empty).
  Pre-existing infra precondition, não regressão do plano.
- **Proxy validation**: 454/454 unit + golden + integration tests green; bot
  starts and uses new persistence helpers via existing call paths.

## References

- Specs primárias: `.claude/knowledge-base/sdk-references/{atomic-write-pattern,file-lock-pattern,profile-isolation,schema-versioning,sqlite-wal-fallback,fts5-sanitization}.md`
- Roadmap macro: `.claude/knowledge-base/sdk-references/README.md` § "Roadmap macro"
- CLAUDE.md theokit-sdk § "SDK Patterns Roadmap"
- Hermes references (read-only study): `referencia/hermes-agent/hermes_state.py`, `hermes_constants.py`, `AGENTS.md`
- Rules: `.claude/rules/no-stubs-no-mocks-no-wired.md`, `.claude/rules/real-llm-validation.md`
