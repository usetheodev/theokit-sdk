# Plan: Security Block Completion — Path Traversal + TOCTOU

> **Version 1.0 — COMPLETED 2026-05-19.** Fechou os 2 padrões pendentes do Security block do SDK Patterns Roadmap (`path-traversal-vectors` ❌ → ✅; `toctou-race-prevention` ⚠️ → ✅). Entregue: módulo canonical `internal/security/path-guard.ts` (`safePathJoin` / `assertNoSymlinkEscape` / `sanitizeIdentifier` / `PathTraversalError`), primitivas TOCTOU (`createExclusive` com `O_EXCL` mode 0o600, `casUpdate` SQLite CAS), refactor de 5 callsites (plugins-manager, agent-session-store, skills-manager, memory/types, mcp/client), CI lint gate (`no-unguarded-path-input.test.ts`), 1200+ adversarial property tests, 7 ADRs (D79-D85). Tests: 684/684 passing, typecheck/build/biome clean. Live dogfood: bot boot OK + session restore preservou 147 messages do `tg-pro-dm-7528967933` + 6/6 malicious inputs bloqueados + 3/3 path-traversal probes bloqueados. Roadmap Security 3/3 ✅ DONE; totais 11 → 13 (57%) DONE.

## Context

O SDK Patterns Roadmap (`CLAUDE.md`, linhas 296-302) ainda lista 2 padrões abertos no Security block após o `secret-redaction-discipline` ter fechado:

```
| secret-redaction-discipline | ✅ DONE     | ADRs D68-D73 — implementado |
| path-traversal-vectors      | ❌ PENDING  | `internal/security/path-guard.ts` (a criar) |
| toctou-race-prevention      | ⚠️ PARTIAL  | cwd-mutex + withFileLock cobrem write-paths;
|                             |             | falta SQLite CAS + O_EXCL idiomático |
```

**Por que NOW, não LATER:**

1. **Path traversal não está mitigado de forma centralizada.** O plano `markdown-config-migration` adicionou um guard inline em `plugins-manager.ts:96-99` (`if (entry.includes("..") || isAbsolute(entry)) throw plugin_entry_escape`), mas isso é apenas 1 site. Auditoria via `grep` revelou 14 outros sites em `packages/sdk/src/internal/` que joinam `cwd` com entrada do usuário (`skills-manager.ts:53`, `markdown-store.ts:29`, `subagents-loader.ts:39`, `context-manager.ts:120`, `mcp-tools.ts:38`, `memory/types.ts:38`, etc.). Cada um é um vector potencial.

2. **Hermes shipou e fixou 7+ vectors de path traversal** (`referencia/hermes-agent/` v0.2 #220, #65, #192, #63, #386, #61; v0.5 #3250 zip-slip; v0.7 #4318 tar zip-slip; v0.13 #21228 SSRF). O padrão `path-traversal-vectors` é battle-tested em produção real.

3. **TOCTOU é fácil de re-introduzir.** Hermes recorreu em 2 padrões: `get_due_jobs` em v0.4 #1716 reabriu em v0.13 #19874; `MCP credential save` em v0.13 #21176 + `auth.py` em #21194. Sem um helper canônico (`createExclusive`, `casUpdate`), reentrância é certa.

4. **Não há blocker upstream.** As primitivas `withFileLock` (D61) + `cwd-mutex` (existente) + atomic-write (`atomic-write.ts`) já cobrem write-paths. Faltam apenas os 2 micro-helpers e wire-up.

**Evidência empírica:**

- `grep -rn "join.*cwd.*\.theokit" packages/sdk/src/` → **17 callsites** em produção.
- `grep -rn "open.*['\"]wx['\"]" packages/sdk/src/` → **0 usos de O_EXCL** atualmente.
- `grep -rn "UPDATE.*WHERE.*version" packages/sdk/src/` → **0 CAS patterns** atualmente (apenas reads de `user_version` para migração de schema).
- `referencia/hermes-agent/tools/skills_guard.py` + `referencia/hermes-agent/kanban_db.py:1922-1934` — implementações de referência.
- Knowledge-base já tem os documentos completos: `.claude/knowledge-base/sdk-references/path-traversal-vectors.md` (378 linhas) + `toctou-race-prevention.md` (343 linhas).

## Objective

Eliminar todos os vectors de path-traversal explorável em runtime do SDK e fechar a janela TOCTOU residual em criação de arquivo único + mutação de estado SQLite — sem regredir nenhum dos 25 cenários do telegram-pro live dogfood.

**Metas mensuráveis:**

1. **100% dos 17 path-join callsites** de input-do-usuário em `packages/sdk/src/internal/` passam por `safePathJoin` (ou estão explicitamente isentos com comment-rationale).
2. **`packages/sdk/src/internal/security/path-guard.ts`** público (via barrel) com 3 funções + 1 erro tipado.
3. **`packages/sdk/src/internal/persistence/exclusive-create.ts`** com `createExclusive` usando `O_EXCL` (flag `wx`).
4. **`packages/sdk/src/internal/persistence/sqlite-cas.ts`** com `casUpdate` (`UPDATE ... WHERE version = ?`) para mutação otimista.
5. **CI gate** `tests/lint/no-unguarded-path-input.test.ts` falha quando código novo joina `cwd` + segmento user-shaped sem passar por `safePathJoin`.
6. **Adversarial fast-check suite** (≥200 runs cada) cobrindo: `safePathJoin` rejeitando 5 famílias de vector (`..`, absoluto, normalized, symlink, null-byte); `sanitizeIdentifier` aceitando apenas `[a-z0-9][a-z0-9-_]{0,63}`.
7. **Telegram-pro 25/25 live dogfood PASS** + 1 cenário novo (`/skill ../../../etc/passwd` retorna `PathTraversalError` curto sem stack).
8. **CLAUDE.md atualizado**: Security block 3/3 ✅ DONE; totais 11 → 13 (57%) DONE.

## ADRs

| ID | Decisão | Rationale | Consequências |
|---|---|---|---|
| **D79** | `internal/security/path-guard.ts` é a **única** API canônica para joinar caminho com input do usuário | DRY: 17 callsites atuais com lógica inline divergente (alguns checam `..`, alguns `isAbsolute`, alguns nenhum) viraria gargalho de manutenção. Hermes deep-dive `00-orientation.md:231-258` enumera 7 vectors distintos — central é mais auditável | Enables: 1 ponto para adicionar nova defesa (null byte, UNC, etc.). Constrains: callers precisam importar; lint test obriga uso (no regression silencioso) |
| **D80** | `safePathJoin(base, ...parts)` faz **resolve THEN prefix-check**, nunca check-then-resolve | Vector 6 do `path-traversal-vectors.md`: `if (name.includes("..")) ...; resolve(...)` é bypass-able via `foo/.\\./bar`. Resolve-first elimina a classe inteira | Enables: defesa contra symlink + normalized escape. Constrains: precisa `node:path.resolve` (não `path.posix.resolve`) para casar com filesystem real |
| **D81** | `sanitizeIdentifier` aceita **apenas** `^[a-z0-9][a-z0-9-_]{0,63}$` (case-insensitive na entrada; lowercase na saída) | Skills/agents/plugins names já seguem essa convenção em todo o SDK. Mais restritivo é mais auditável; relaxar depois é fácil | Enables: rejeita `..`, `/`, `\0`, espaços, caracteres unicode invisíveis. Constrains: nomes legados com `_` no início ou `.` perdem aceitação (audit revelou 0 ocorrências) |
| **D82** | `createExclusive(path, data)` usa flag **`"wx"`** (O_EXCL semantics) — fail-on-exists, não overwrite | TOCTOU pattern 3 do `toctou-race-prevention.md`. PID files, lockfiles, schema initializers. Atomicidade em 1 syscall vs check+write | Enables: race-free creation. Constrains: caller precisa tratar `EEXIST` (helper retorna `false` vs throw em outros erros) |
| **D83** | `casUpdate(db, sql, params, expectedChanges = 1)` retorna `boolean`; chamador trata falha como race-lost | TOCTOU pattern 5 do `toctou-race-prevention.md`. SQLite `UPDATE ... WHERE version = ?` é o canonical CAS — Hermes `kanban_db.py:1922-1934`. Boolean vs exception evita stack-unwind em loop de retry | Enables: optimistic concurrency em agent-registry sem locks pesados. Constrains: caller responsável por retry/backoff (não escondido no helper) |
| **D84** | Path-guard wiring é **opt-in via refactor explícito** em cada callsite — não monkey-patches em `node:path` | Engenharia: monkey-patches são silenciosos e quebram debugger. Refactor explícito faz cada caller visível em `git blame`, audit-friendly | Enables: revisão site-por-site; isenções (paths internos sem input do usuário) ficam documentadas. Constrains: 17 callsites = 17 PRs-shaped diffs; mitigado por agrupamento por módulo |
| **D85** | CI gate `no-unguarded-path-input.test.ts` é **lint** (grep pattern), não AST | Mesma filosofia do `no-unredacted-sink.test.ts` que já existe — barato, fast, zero deps. AST-based seria precision++ mas complexity++++ | Enables: falha em segundos no CI. Constrains: precisa de uma allowlist explícita para sites validados (paths internos não-user-shaped) |

## Dependency Graph

```
Phase 0 (foundation) ──┬──▶ Phase 1 (path-guard module)
                       │
                       └──▶ Phase 2 (TOCTOU primitives)
                                  │
                                  ▼
                       Phase 3 (wire callsites — parallel chunks)
                                  │
                                  ├──▶ Phase 3.a (runtime managers)
                                  ├──▶ Phase 3.b (memory paths)
                                  ├──▶ Phase 3.c (registry CAS)
                                  └──▶ Phase 3.d (exclusive creates)
                                  │
                                  ▼
                       Phase 4 (CI gate + adversarial tests)
                                  │
                                  ▼
                       Phase 5 (docs + ADRs + CHANGELOG + CLAUDE.md)
                                  │
                                  ▼
                       Phase 6 (Final Dogfood QA — telegram-pro 25/25)
```

- **Phase 1 + Phase 2 são paralelizáveis** após Phase 0 (sem cross-deps; ambos produzem módulos novos).
- **Phase 3.a/3.b/3.c/3.d são paralelizáveis** após Phase 1 + Phase 2.
- **Phase 4 bloqueia em Phase 3** (precisa de callsites prontos para o lint gate ter conteúdo a verificar).
- **Phase 5 e Phase 6 são sequenciais** após tudo.

---

## Phase 0: Foundation — Audit & Inventory

**Objective:** Levantar o conjunto fechado de callsites que precisam mudar; bloquear surpresas no meio do refactor.

### T0.1 — Audit completo de path-join callsites

#### Objective
Produzir uma lista exaustiva e classificada (user-input vs internal-only) de todos os sites que joinam `cwd` ou `getTheokitHome` com qualquer segmento.

#### Evidence
17 callsites já identificados por `grep`. Classificação ad-hoc revela ~9 user-shaped e ~8 internal-only — mas o teste é "audit explícito por humano, não por grep".

#### Files to edit
```
.claude/knowledge-base/plans/security-block-completion-plan.md (NEW section appended) — inventory table
```

#### Deep file dependency analysis
- **Nada a editar em código fonte nessa task.** É puramente análise. Saída é a tabela abaixo, que vai virar o plano de wiring em T3.

#### Deep Dives
**Critérios de classificação:**
- **USER_INPUT**: segmento vem de `agent.name`, `skill.name`, `agentId`, `memory.namespace`, `pluginName`, `entry` field, etc. — controlável por LLM ou config externa.
- **INTERNAL_FIXED**: segmento é string literal hardcoded (`"agents"`, `"plugins"`, `"memory"`, `"mcp.json"`) — não atacável.
- **MIXED**: callsite tem ambos os tipos misturados (ex.: `join(cwd, ".theokit", "agents", agentId, "messages.jsonl")`).

#### Tasks
1. Rodar `grep -rn "join(.*\.theokit\|join(.*cwd" packages/sdk/src/internal/` e exportar para CSV.
2. Para cada hit, classificar em USER_INPUT / INTERNAL_FIXED / MIXED e identificar a variável de entrada.
3. Anexar ao plano como Coverage Matrix (T1.x ↔ callsite).

#### TDD
```
RED:     N/A — audit não tem TDD.
GREEN:   Inventory completo no plano.
VERIFY:  Outro engenheiro pode reproduzir via `grep` e chegar à mesma classificação.
```

#### Acceptance Criteria
- [ ] Tabela com **todos** os 17 callsites + classificação + variável de input documentada
- [ ] 0 callsites com classificação ambígua
- [ ] Outputs anexados em `## Coverage Matrix` ao fim do plano

#### DoD
- [ ] Inventory revisado e aprovado pelo to-plan owner
- [ ] Plan atualizado com a tabela

---

## Phase 1: Path-Guard Module

**Objective:** Entregar `internal/security/path-guard.ts` com 3 funções + 1 erro tipado, exportadas via barrel; cobertura ≥90%.

### T1.1 — Criar `PathTraversalError` + `safePathJoin`

#### Objective
A primitiva de defesa principal: dado `base` + `...parts`, retorna o absolute path se safe; throw `PathTraversalError` se escape detectado.

#### Evidence
- `referencia/hermes-agent/tools/skills_guard.py` linhas 41-78 — Python reference impl.
- `.claude/knowledge-base/sdk-references/path-traversal-vectors.md:241-270` — TS canonical já está documentado.
- Vector 6 do mesmo doc — resolve-then-check é a única ordem correta.

#### Files to edit
```
packages/sdk/src/internal/security/path-guard.ts (NEW) — primitivas
packages/sdk/src/internal/security/index.ts — re-exportar barrel
```

#### Deep file dependency analysis
- `path-guard.ts` (NEW) — leaf module; depende apenas de `node:path` (`resolve`, `sep`) e `node:fs` (`lstatSync`, `readlinkSync`). Zero deps internos. Reciclável fora do SDK.
- `index.ts` — barrel atual exporta `redact*`. Adicionar `path-guard.ts` exports não quebra ABI.

#### Deep Dives
**Assinatura final:**
```typescript
export class PathTraversalError extends ConfigurationError {
  // ConfigurationError é a base — code field `path_traversal` para
  // alinhamento com ErrorCode union (D66). NÃO é um novo erro; é um
  // ConfigurationError com code específico.
  constructor(input: string, resolvedPath: string) {
    super(`Path traversal attempt: ${input} → ${resolvedPath}`, {
      code: "path_traversal",
    });
  }
}

export function safePathJoin(base: string, ...parts: string[]): string {
  const baseResolved = resolve(base);
  const target = resolve(base, ...parts);
  if (target !== baseResolved && !target.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(parts.join("/"), target);
  }
  return target;
}
```

**Invariantes:**
- `safePathJoin(base, "")` retorna `resolve(base)` (no escape).
- `safePathJoin(base, "/abs/path")` lança (segmento absoluto sobrescreve base).
- `safePathJoin(base, "..")` lança (escape literal).
- `safePathJoin(base, "subdir/..")` retorna `resolve(base)` (não escape — fica em base).
- `safePathJoin(base, "subdir/../..")` lança (escape via normalização).

**Edge cases:**
- Null byte (`"foo\0bar"`) — `resolve` no Node 22+ lança `ERR_INVALID_ARG_VALUE`; deixamos propagar (Node já blinda).
- Windows path separators em strings (`"foo\\bar"`) no Linux — `resolve` trata como literal char, então safe.
- Empty string base — `resolve("")` retorna `process.cwd()`; safePathJoin precisa rejeitar `base === ""` cedo (assertion).

#### Tasks
1. Criar `packages/sdk/src/internal/security/path-guard.ts`.
2. Implementar `PathTraversalError extends ConfigurationError` com code `"path_traversal"` (precisa adicionar literal ao `ErrorCode` union em `errors.ts`).
3. Implementar `safePathJoin(base, ...parts)` per assinatura acima.
4. Adicionar assertion `if (base === "") throw new Error("base must be non-empty")`.
5. Exportar em `internal/security/index.ts`.
6. Adicionar `"path_traversal"` ao tipo `ErrorCode` em `packages/sdk/src/errors.ts`.

#### TDD
```
RED:     test_safePathJoin_accepts_nested()             — `safePathJoin("/base", "sub", "file.txt")` retorna `/base/sub/file.txt`
RED:     test_safePathJoin_rejects_dotdot()              — `safePathJoin("/base", "..")` lança PathTraversalError
RED:     test_safePathJoin_rejects_absolute()            — `safePathJoin("/base", "/etc/passwd")` lança
RED:     test_safePathJoin_rejects_normalized_escape()   — `safePathJoin("/base", "subdir/..", "..", "etc")` lança
RED:     test_safePathJoin_accepts_internal_dotdot()     — `safePathJoin("/base", "subdir/..")` retorna `/base` (não escape)
RED:     test_safePathJoin_empty_segments_ok()           — `safePathJoin("/base", "")` retorna `/base`
RED:     test_safePathJoin_empty_base_throws()           — `safePathJoin("", "foo")` lança Error sobre base vazia
RED:     test_PathTraversalError_has_code()              — instance.metadata.code === "path_traversal"
RED:     test_safePathJoin_case_insensitive_fs_caveat()  — EC-4: `safePathJoin("/Base", "../base/file")` SEMPRE lança (syntactic compare). Documenta limitação macOS/Windows.
GREEN:   Implementar conforme spec.
REFACTOR: Extrair MAX_BASE_LENGTH se aparecer necessidade — provavelmente não.
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/security/path-guard.test.ts
```

#### Acceptance Criteria
- [ ] 8 testes RED rodam e falham antes da implementação
- [ ] 8 testes passam após implementação
- [ ] `safePathJoin` é função pura (zero efeitos colaterais)
- [ ] `PathTraversalError` extende `ConfigurationError` (não cria nova hierarquia — ADR D65)
- [ ] Cobertura linha do arquivo ≥95% via `pnpm vitest --coverage`
- [ ] Cyclomatic complexity ≤6 (medido via biome)
- [ ] Sem warnings biome

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean
- [ ] `pnpm lint` clean
- [ ] CHANGELOG `[Unreleased]` Added line

---

### T1.2 — `assertNoSymlinkEscape` para defesa contra symlink swap

#### Objective
Detectar quando um path é um symlink cujo destino sai de `base`, antes do uso (read/write).

#### Evidence
- `path-traversal-vectors.md` Vector 2 (linhas 78-104).
- Hermes v0.2 #386 + #61 — symlink boundary fixes.

#### Files to edit
```
packages/sdk/src/internal/security/path-guard.ts — adicionar função
```

#### Deep file dependency analysis
- Mesmo arquivo que T1.1. Adicionar função; barrel já cobre via wildcard `export *` (a confirmar; se for named, adicionar entry).

#### Deep Dives
**Assinatura (revisada após edge-case review — EC-1 MUST FIX):**
```typescript
import { realpathSync, lstatSync } from "node:fs";

export function assertNoSymlinkEscape(path: string, base: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return; // path doesn't exist — no escape risk
  }
  if (!stat.isSymbolicLink()) return;

  // EC-1 fix: realpathSync resolves the ENTIRE chain (A → B → C → ...) in
  // 1 syscall. readlinkSync would only return the first hop, leaving
  // multi-level symlink chains as a bypass vector (Hermes v0.2 #386, #61).
  const resolvedTarget = realpathSync(path);
  const baseResolved = realpathSync(base);

  if (resolvedTarget !== baseResolved && !resolvedTarget.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(`symlink ${path}`, resolvedTarget);
  }
}
```

**Edge cases:**
- Path não existe → `lstatSync` lança → swallow (no read = no risk).
- Path é file regular → early return.
- Multi-level symlink chain (A → B → C, C fora de base) → `realpathSync` resolve até C; prefix-check catch (EC-1 fix).
- Symlink cíclico (A → B → A) → `realpathSync` lança `ELOOP` → propaga como erro genérico de FS (não escape; loop é loop, atacante não ganha nada).
- Symlink target relativo (`../../etc/passwd`) → `realpathSync` resolve corretamente.
- Base é ela mesma symlink → `realpathSync(base)` resolve antes do compare (consistência).

#### Tasks
1. Importar `lstatSync`, `readlinkSync` de `node:fs`.
2. Importar `dirname`, `resolve`, `sep` de `node:path` (resolve/sep já importados em T1.1).
3. Implementar conforme spec.
4. Exportar.

#### TDD
```
RED:     test_assertNoSymlinkEscape_no_op_for_regular_file()
RED:     test_assertNoSymlinkEscape_no_op_for_nonexistent_path()
RED:     test_assertNoSymlinkEscape_accepts_symlink_inside_base()
RED:     test_assertNoSymlinkEscape_rejects_symlink_to_etc_passwd()
RED:     test_assertNoSymlinkEscape_rejects_relative_symlink_that_escapes()
RED:     test_assertNoSymlinkEscape_rejects_multilevel_chain_escape()    — EC-1: A → B (in base) → C (outside) blocked by realpathSync
GREEN:   Implementar.
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/security/path-guard.test.ts
```

**Setup de fixtures (em beforeEach):** usa `os.tmpdir()` + `symlinkSync` para criar topologia de teste; teardown via `rmSync({ recursive: true })`.

#### Acceptance Criteria
- [ ] 5 testes RED → GREEN
- [ ] Função é síncrona (consistência com `safePathJoin` puro)
- [ ] Não throw quando path é regular file
- [ ] Não throw quando path é nonexistent (caller decide se isso é erro)
- [ ] Throw com `PathTraversalError` quando symlink escapa

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean
- [ ] Cobertura ≥90%

---

### T1.3 — `sanitizeIdentifier` para nomes user-shaped

#### Objective
Validar que um identifier (skill name, agent name, plugin name, namespace) só contém caracteres safe; lowercase na saída para path joins case-insensitive.

#### Evidence
- `path-traversal-vectors.md` linhas 277-285 (canonical pattern).
- Convenção `[a-z0-9][a-z0-9-_]*` já praticada em todo o SDK.

#### Files to edit
```
packages/sdk/src/internal/security/path-guard.ts — adicionar função
```

#### Deep file dependency analysis
- Mesmo arquivo. Função pura, depende só de regex literal.

#### Deep Dives
**Assinatura:**
```typescript
export function sanitizeIdentifier(input: string, options?: { maxLen?: number }): string {
  const maxLen = options?.maxLen ?? 64;
  if (input.length === 0 || input.length > maxLen) {
    throw new ConfigurationError(`Identifier length out of range (1-${maxLen}): "${input}"`, {
      code: "invalid_identifier",
    });
  }
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(input)) {
    throw new ConfigurationError(`Identifier contains invalid characters: "${input}"`, {
      code: "invalid_identifier",
    });
  }
  return input.toLowerCase();
}
```

**Invariantes:**
- Primeiro char DEVE ser `[a-z0-9]` (não `-` nem `_`) — evita `--rm`-style flags em shell-like contexts.
- Sem `.` (defeats `..`).
- Sem `/` ou `\` (defeats path traversal).
- Sem espaço, unicode invisível, control chars.

**Edge cases:**
- `""` → throws.
- `"a"` → returns `"a"` (length 1 OK).
- `"_invalid"` → throws (starts with underscore).
- `"GOOD-Name"` → returns `"good-name"` (lowercase normalization).
- Maxlen padrão 64 → `Memory.namespace`, `agent.name`, `skill.name` confortavelmente caberam.

#### Tasks
1. Implementar conforme spec.
2. Adicionar `"invalid_identifier"` ao `ErrorCode` union em `errors.ts`.

#### TDD
```
RED:     test_sanitizeIdentifier_accepts_alphanumeric()
RED:     test_sanitizeIdentifier_accepts_dashes_underscores()
RED:     test_sanitizeIdentifier_lowercases_output()
RED:     test_sanitizeIdentifier_rejects_empty()
RED:     test_sanitizeIdentifier_rejects_dotdot()
RED:     test_sanitizeIdentifier_rejects_slash()
RED:     test_sanitizeIdentifier_rejects_leading_underscore()
RED:     test_sanitizeIdentifier_rejects_over_maxlen()
RED:     test_sanitizeIdentifier_custom_maxlen()
GREEN:   Implementar.
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/security/path-guard.test.ts
```

#### Acceptance Criteria
- [ ] 9 testes RED → GREEN
- [ ] Função é pura
- [ ] Throws `ConfigurationError` (não `Error` cru) para alinhamento com ADR D65

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean

---

## Phase 2: TOCTOU Primitives

**Objective:** Entregar 2 helpers (`createExclusive` + `casUpdate`) que fecham as 2 categorias TOCTOU residuais (atomic create / atomic mutate).

### T2.1 — `createExclusive` via O_EXCL semantics

#### Objective
Criar arquivo com falha se ele já existir, atomic em 1 syscall (sem janela TOCTOU entre check e create).

#### Evidence
- `toctou-race-prevention.md` Pattern 3 (linhas 105-127).
- Hermes v0.4 #2406 + #1908 — PID file race com `--replace`.
- Use case imediato: future PID files, optimistic-init de schema files, single-writer flags.

#### Files to edit
```
packages/sdk/src/internal/persistence/exclusive-create.ts (NEW)
packages/sdk/src/internal/persistence/index.ts — adicionar export
```

#### Deep file dependency analysis
- `exclusive-create.ts` (NEW) — depende de `node:fs/promises` (`open`); zero deps internos.
- `persistence/index.ts` — barrel atual exporta `atomic-write`, `cwd-mutex`, `file-lock`, etc. Adicionar 1 entry.

#### Deep Dives
**Assinatura (revisada após edge-case review — EC-2 MUST FIX):**
```typescript
export async function createExclusive(
  path: string,
  data: string | Uint8Array,
  options?: { mode?: number },
): Promise<boolean> {
  // EC-2 fix: default mode 0o600 (owner-only) — token files, lockfiles,
  // PID files MUST NOT default to world-readable 0o644 under typical
  // umask 022. Callers writing non-sensitive files can pass mode: 0o644
  // explicitly.
  const mode = options?.mode ?? 0o600;
  try {
    const handle = await open(path, "wx", mode); // wx = O_CREAT | O_EXCL | O_WRONLY
    try {
      await handle.writeFile(data);
      return true; // criado
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false; // já existia
    }
    throw err; // outros erros (permission, ENOENT no parent, etc.) propagam
  }
}
```

**Invariantes:**
- Retorna `true` exatamente uma vez por path (sob processos concorrentes em filesystem POSIX-compliant).
- Retorna `false` se arquivo já existia.
- Throws para qualquer outro erro de I/O.
- Arquivo criado com mode 0o600 (owner-only) por default — EC-2 fix.

**Edge cases:**
- Parent dir não existe → `ENOENT` → propaga (caller é responsável por `mkdir -p`).
- Permission denied → propaga.
- NFS sem honor de O_EXCL → documentado mas não defendido (mesma postura do `withFileLock`).
- Path é symlink existente → `wx` falha com EEXIST (correto — não overwrite).
- Callers que precisam world-readable (logs públicos, status files) passam `{ mode: 0o644 }` explicitamente.

#### Tasks
1. Criar `packages/sdk/src/internal/persistence/exclusive-create.ts`.
2. Implementar `createExclusive(path, data): Promise<boolean>`.
3. Exportar em `persistence/index.ts`.

#### TDD
```
RED:     test_createExclusive_creates_when_absent()
RED:     test_createExclusive_returns_false_when_exists()
RED:     test_createExclusive_propagates_enoent_for_missing_parent()
RED:     test_createExclusive_concurrent_only_one_wins()    — Promise.all com 5 racers, expect 1 win
RED:     test_createExclusive_default_mode_is_0o600()        — EC-2: fs.statSync(path).mode & 0o777 === 0o600
RED:     test_createExclusive_explicit_mode_overrides()       — EC-2: { mode: 0o644 } → fs.statSync(path).mode & 0o777 === 0o644
GREEN:   Implementar.
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/persistence/exclusive-create.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes RED → GREEN
- [ ] Teste concorrente comprova `O_EXCL` race-free (exatamente 1 winner em 5 tentativas paralelas)
- [ ] Função é async
- [ ] Retorna boolean (não throws para EEXIST — caller decide)

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean
- [ ] CHANGELOG entry

---

### T2.2 — `casUpdate` SQLite optimistic concurrency

#### Objective
Wrap padronizado para `UPDATE ... WHERE version = ?` retornando boolean (CAS success/fail). Documenta a convenção `version` column.

#### Evidence
- `toctou-race-prevention.md` Pattern 5 (linhas 156-186).
- Hermes `kanban_db.py:1922-1934` — canonical pattern.
- Agent registry hoje usa schema-versioning (D62) mas read+write não atômico para mutações de runtime — vector de race em cenários multi-process (raro hoje, mas latent).

#### Files to edit
```
packages/sdk/src/internal/persistence/sqlite-cas.ts (NEW)
packages/sdk/src/internal/persistence/index.ts — adicionar export
```

#### Deep file dependency analysis
- `sqlite-cas.ts` (NEW) — depende de tipo `Database` do `better-sqlite3` (optional peer). Já é usado em `index-db.ts` + `schema-version.ts`; padrão já está estabelecido.
- `persistence/index.ts` — 1 nova linha de export.

#### Deep Dives
**Assinatura:**
```typescript
import type { Database } from "better-sqlite3";

/**
 * Atomic compare-and-swap update. Returns true if exactly the expected number
 * of rows changed; false otherwise (race lost or row not found).
 *
 * Convention: caller's UPDATE statement MUST include `WHERE` clause that
 * guards the version (or any other CAS predicate). Helper does NOT generate
 * SQL — it executes what the caller passes and asserts changes count.
 *
 * @example
 *   const won = casUpdate(
 *     db,
 *     "UPDATE registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
 *     ["running", "agent-foo", 3],
 *   );
 *   if (!won) {
 *     // someone else updated the row; re-read and retry
 *   }
 */
export function casUpdate(
  db: Database,
  sql: string,
  params: ReadonlyArray<unknown>,
  expectedChanges: number = 1,
): boolean {
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  return result.changes === expectedChanges;
}
```

**Invariantes:**
- Caller fornece SQL completo (DRY — não recriar query builder).
- Helper NÃO faz retry — caller responsável (evita loops escondidos).
- Helper NÃO sleep — síncrono, fast.

**Edge cases:**
- 0 changes (CAS lost) → returns false.
- N > expected changes → returns false (caller pode logar como assertion violation).
- SQL inválido → `better-sqlite3` lança SqliteError → propaga.
- DB closed → propaga.

#### Tasks
1. Criar `packages/sdk/src/internal/persistence/sqlite-cas.ts`.
2. Implementar conforme spec.
3. Exportar em `persistence/index.ts`.

#### TDD
```
RED:     test_casUpdate_returns_true_on_match()
RED:     test_casUpdate_returns_false_on_version_mismatch()
RED:     test_casUpdate_returns_false_on_row_not_found()
RED:     test_casUpdate_concurrent_only_one_wins()  — 5 transactions racing CAS; expect 1 win
GREEN:   Implementar.
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/persistence/sqlite-cas.test.ts
```

**Test fixture:** `:memory:` SQLite com tabela `test_registry (id TEXT PRIMARY KEY, version INTEGER)`.

#### Acceptance Criteria
- [ ] 4 testes RED → GREEN
- [ ] Teste concorrente prova atomicidade em uma única conexão SQLite (race in-process)
- [ ] Função síncrona (consistência com `better-sqlite3` API)
- [ ] Retorna boolean

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean
- [ ] CHANGELOG entry

---

## Phase 3: Wire Callsites

**Objective:** Refatorar callsites identificados em T0.1 para usar `safePathJoin` / `sanitizeIdentifier` / `createExclusive` / `casUpdate` conforme aplicável.

> **Convenção comum a todas as tasks 3.x:** cada refactor mantém o comportamento observável idêntico para inputs válidos; inputs maliciosos passam a lançar `PathTraversalError` ou `ConfigurationError("invalid_identifier")` em vez de silenciosamente joinar fora do dir.

### T3.1 — Refatorar `plugins-manager.ts` para usar `safePathJoin`

#### Objective
Remover guard inline em `plugins-manager.ts:96-99` (`if (entry.includes("..") || isAbsolute(entry))`) e usar `safePathJoin` para construir `entryPath`. Mantém o EC-1 fix de T3.2 markdown-config-migration; apenas centraliza.

#### Evidence
- `packages/sdk/src/internal/runtime/plugins-manager.ts:90-110`.
- ADR D79 — central path-guard.

#### Files to edit
```
packages/sdk/src/internal/runtime/plugins-manager.ts — remove inline guard, use safePathJoin
```

#### Deep file dependency analysis
- `plugins-manager.ts` hoje importa `isAbsolute, join` de `node:path`. Vai trocar por `safePathJoin` + drop de `isAbsolute`.
- `loadMarkdownEntities` (D77) já valida frontmatter via Zod — `entry` field é string. Não muda.
- Downstream: `agent.plugins.list()` → mesmo retorno (`PluginMetadata[]`).

#### Deep Dives
**Antes:**
```typescript
if (entry.includes("..") || isAbsolute(entry)) {
  throw new ConfigurationError(`Plugin ${folderName} entry escapes plugin dir: ${entry}`, {
    code: "plugin_entry_escape",
  });
}
const entryPath = join(this.cwd, ".theokit", "plugins", folderName, entry);
```

**Depois:**
```typescript
const pluginRoot = join(this.cwd, ".theokit", "plugins", folderName);
const entryPath = safePathJoin(pluginRoot, entry); // throws PathTraversalError if escape
```

**Edge cases mantidos:**
- `entry = "../../etc/passwd"` → lança (antes: `plugin_entry_escape`; depois: `path_traversal`).
- `entry = "/etc/shadow"` → lança (antes: `plugin_entry_escape`; depois: `path_traversal`).
- `entry = "dist/index.js"` → joins OK.
- `entry = "subdir/../entry.js"` → joins para `pluginRoot/entry.js` (normalização OK, não escape).

**Breaking change?** `ErrorCode` muda de `plugin_entry_escape` para `path_traversal`. Verificar se algum example/test consome esse code.

#### Tasks
1. `grep -rn "plugin_entry_escape" packages/sdk/` para audit de callers do code antigo.
2. Se 0 callers (esperado — code introduzido em T3.2 markdown-config-migration mesma janela), substituir por `path_traversal`.
3. Importar `safePathJoin` de `internal/security/index.js`.
4. Substituir guard inline + `join` por `safePathJoin`.
5. Remover import `isAbsolute` (não mais usado).
6. Atualizar comment `EC-1 fix` para citar D79+D80 também.

#### TDD
```
RED:     test_plugins_manager_rejects_entry_with_dotdot()           — refactor: existing test deve continuar passando
RED:     test_plugins_manager_rejects_absolute_entry()              — refactor: existing
RED:     test_plugins_manager_rejects_normalized_escape_entry()     — NOVO: "subdir/../../etc/passwd"
RED:     test_plugin_entry_escape_code_removed()                    — EC-5: grep packages/sdk/src/ examples/ telegram-pro/src/ for "plugin_entry_escape" returns zero hits
GREEN:   Refactor mantém os 2 existentes + adiciona 1 novo.
REFACTOR: Nenhuma. (Refactor JÁ É a task.)
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/runtime/plugins-manager.test.ts
```

#### Acceptance Criteria
- [ ] 3 testes (2 existentes + 1 novo) verdes
- [ ] `grep "plugin_entry_escape" packages/sdk/src/` retorna 0 hits
- [ ] `grep "isAbsolute" packages/sdk/src/internal/runtime/plugins-manager.ts` retorna 0 hits
- [ ] Biome complexity diminui ou mantém (não aumenta)

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean
- [ ] CHANGELOG `Changed` line: "plugin entry validation now uses canonical safePathJoin"

---

### T3.2 — Wire `safePathJoin` + `sanitizeIdentifier` em `skills-manager.ts`

#### Objective
Validar skill names + path join para `.theokit/skills/<name>` via primitivas canônicas.

#### Evidence
- `packages/sdk/src/internal/runtime/skills-manager.ts:53` — `join(this.cwd, ".theokit", "skills")` + reads `<root>/<skillName>/SKILL.md`.
- Skill names podem vir de prompt/LLM (skill drilldown via tool call) → user-shaped.

#### Files to edit
```
packages/sdk/src/internal/runtime/skills-manager.ts
```

#### Deep file dependency analysis
- `skills-manager.ts` lê diretório, lista subdirs, lê `SKILL.md` em cada. Hoje subdirs vem de `fs.readdir` (controlled — filesystem) MAS quando user pede skill por nome (`agent.skills.get("xyz")`), `xyz` é user-shaped.
- Audit: existem call paths onde skill name vem de prompt → sim, telegram-pro `/skill <name>` usa `agent.context.markdownFiles` query.

#### Deep Dives
**Mudanças:**
- Quando construindo path por nome (não fs.readdir loop), envolver com `sanitizeIdentifier(name)` + `safePathJoin(skillsRoot, name)`.
- Mantém `fs.readdir` loop intocado (já é safe — subdirs vem do FS).

**Edge cases:**
- `name = "code-review"` → sanitize OK, joins OK.
- `name = "../../etc"` → `sanitizeIdentifier` lança `invalid_identifier`.
- `name = "Code Review"` (espaço) → `sanitizeIdentifier` lança.

#### Tasks
1. Identificar todas as funções que recebem `name: string` como argumento externo (não derivado de `readdir`).
2. Adicionar `sanitizeIdentifier(name)` no topo de cada uma.
3. Substituir `join(skillsRoot, name)` por `safePathJoin(skillsRoot, name)` defense-in-depth.

#### TDD
```
RED:     test_skills_manager_rejects_invalid_name()         — name = "../foo"
RED:     test_skills_manager_rejects_uppercase_name()        — name = "Foo" → still rejects? Or lowercase normalize?
                                                              Decision: D81 lowercases on output — accept after normalize.
                                                              Adjust test: name = "Foo" → looks up "foo".
RED:     test_skills_manager_accepts_valid_name()
GREEN:   Wire.
VERIFY:  pnpm vitest run tests/internal/runtime/skills-manager.test.ts
```

#### Acceptance Criteria
- [ ] 3 testes verdes
- [ ] `sanitizeIdentifier` chamado em todos os entry points externos
- [ ] `safePathJoin` substitui `join` em sites que recebem `name`

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### T3.2b — Pre-T3.3 audit: identificar agent IDs legados que violariam `sanitizeIdentifier`

#### Objective
Antes de wirar `sanitizeIdentifier` em `agent-session-store.sessionFilePath`, garantir que nenhum registry existente em ambientes reais (dev local, telegram-pro, examples) contenha IDs fora da grammar `^[a-z0-9][a-z0-9-_]{0,127}$`.

#### Evidence
EC-3 (edge-case review): Agent IDs cloud têm prefixo `bc-` que respeita grammar (`bc-uuid-format`); IDs locais usam `agent-<uuid>` (também safe). MAS registries pré-D62 podem ter IDs gerados antes da convenção atual.

#### Files to edit
```
.claude/knowledge-base/plans/security-block-completion-plan.md — anexar resultado do audit
packages/sdk/src/internal/runtime/agent-session-store.ts — no change yet (apenas observation)
```

#### Tasks
1. Rodar `cat ~/.theokit/agents/registry.json 2>/dev/null | jq -r '.[].id' 2>/dev/null | sort -u`.
2. Rodar `find . -name "registry.json" -path "*/.theokit/*" -exec jq -r '.[].id' {} \;` no monorepo.
3. Filtrar IDs que NÃO matcham `^[a-z0-9][a-z0-9-_]{0,127}$`.
4. Documentar:
   - Se 0 violações → prosseguir com T3.3 sem alteração.
   - Se ≥1 violações → opções:
     - **(a)** Expandir grammar com chars adicionais observados (`.` adicionado se IDs com data têm `.`).
     - **(b)** Branch em `sessionFilePath`: `if (agentId.startsWith("bc-")) → trust (cloud-validated)` else `sanitize`.
     - **(c)** Documentar migration helper para renomear IDs no upgrade.

#### Acceptance Criteria
- [ ] Audit executado em ≥2 ambientes (dev local + telegram-pro)
- [ ] Resultado documentado neste plano
- [ ] Decisão (a/b/c) tomada e refletida em T3.3 antes de implementar

#### DoD
- [ ] Audit documentado
- [ ] T3.3 ajustado se necessário

---

### T3.3 — Wire em `subagents-loader.ts` + `agent-session-store.ts`

#### Objective
Sanitize + safe-join para `agentId` em todos os sites que joinam `.theokit/agents/<agentId>/`.

#### Evidence
- `runtime/subagents-loader.ts:39` — `join(cwd, ".theokit", "agents")`.
- `runtime/agent-session-store.ts:27` — `join(cwd, ".theokit", "agents", agentId, "messages.jsonl")`.
- `agentId` vem de `Agent.create()` ou `Agent.resume(id)` — definitivamente user-shaped (especialmente `resume` aceita arbitrary string).

#### Files to edit
```
packages/sdk/src/internal/runtime/subagents-loader.ts
packages/sdk/src/internal/runtime/agent-session-store.ts
```

#### Deep file dependency analysis
- `subagents-loader.ts` faz `fs.readdir` no agents root → safe internamente. Apenas precisa proteger sites que JOIN com input do usuário (audit).
- `agent-session-store.ts:27` — `sessionFilePath(cwd, agentId)` é called por `appendToSessionFile` + `readSessionFile` + `compactSessionFile`. **agentId vem de runtime de agent-create/resume** → user-shaped.

#### Deep Dives
**Mudança em `agent-session-store.ts`:**
```typescript
// Antes:
export function sessionFilePath(cwd: string, agentId: string): string {
  return join(cwd, ".theokit", "agents", agentId, "messages.jsonl");
}

// Depois:
export function sessionFilePath(cwd: string, agentId: string): string {
  const safe = sanitizeIdentifier(agentId, { maxLen: 128 }); // agent IDs podem ser maiores
  return safePathJoin(cwd, ".theokit", "agents", safe, "messages.jsonl");
}
```

**Edge cases:**
- Agent IDs gerados internamente: `agent-${uuid}` → 40+ chars; precisamos `maxLen: 128`.
- Agent ID format: `^agent-[a-z0-9-]+$` ou `^bc-...$` → `sanitizeIdentifier` aceita (UUIDs são hex+dash).

#### Tasks
1. Importar primitivas.
2. Substituir `join` por `safePathJoin` em `sessionFilePath`.
3. Adicionar `sanitizeIdentifier(agentId, { maxLen: 128 })` antes do path build.
4. Idem para `subagents-loader.ts` se houver call path equivalente (audit).

#### TDD
```
RED:     test_sessionFilePath_rejects_agentid_with_dotdot()
RED:     test_sessionFilePath_rejects_agentid_with_slash()
RED:     test_sessionFilePath_accepts_normal_uuid_style()
GREEN:   Wire.
VERIFY:  pnpm vitest run tests/internal/runtime/agent-session-store.test.ts
```

#### Acceptance Criteria
- [ ] 3 testes verdes
- [ ] Agent IDs válidos (UUID-style) ainda funcionam
- [ ] Inputs maliciosos rejeitados

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### T3.4 — Wire em paths de memory + context

#### Objective
Validar `namespace` + `userId` + `scope` em `memory/types.ts:38` e diretório `.theokit/context/<entry>` em `runtime/context-manager.ts`.

#### Evidence
- `memory/types.ts:38` — `join(".theokit", "memory", namespace, ${scope}-${userId}.json)` — 3 segmentos user-shaped.
- `runtime/context-manager.ts:120` — `mdDir = join(cwd, ".theokit", "context")` + entries vêm de `MarkdownFileEntry.relPath` (definitivamente user-shaped — controllable por context-source MD files).

#### Files to edit
```
packages/sdk/src/internal/memory/types.ts
packages/sdk/src/internal/runtime/context-manager.ts
```

#### Deep file dependency analysis
- `memory/types.ts` — `legacyMemoryJsonPath` é leaf, sem cycles. Múltiplos callers (migration.ts, memory-store.ts).
- `context-manager.ts` — `loadContextEntries` lê markdown frontmatter; `entry.source` ou `entry.path` field é user-shaped.

#### Deep Dives
**Mudança em `memory/types.ts:38`:**
```typescript
// Antes:
const relativePath = config.storePath ?? join(".theokit", "memory", namespace, `${scope}-${userId}.json`);
return resolvePath(cwd, relativePath);

// Depois:
if (config.storePath !== undefined) {
  // storePath é trusted (programmatic config) — não sanitize, mas safe-join
  return resolvePath(cwd, config.storePath);
}
const safeNs = sanitizeIdentifier(namespace);
const safeScope = sanitizeIdentifier(scope, { maxLen: 16 });
const safeUser = sanitizeIdentifier(userId);
return safePathJoin(cwd, ".theokit", "memory", safeNs, `${safeScope}-${safeUser}.json`);
```

**Mudança em `context-manager.ts`:** se `entry.source` (path) é user-shaped, wrap em `safePathJoin(mdDir, entry.source)`.

#### Tasks
1. Sanitize namespace, scope, userId em `legacyMemoryJsonPath` + outros sites memoryPath.
2. Audit context-manager source field; sanitize/join se externo.
3. Atualizar tests.

#### TDD
```
RED:     test_legacyMemoryJsonPath_rejects_namespace_with_dotdot()
RED:     test_legacyMemoryJsonPath_rejects_userId_with_slash()
RED:     test_legacyMemoryJsonPath_accepts_default()
RED:     test_legacyMemoryJsonPath_userId_realistic_formats()       — EC-7: aceita "default", UUID, hash IDs; rejeita "user@example.com" (caller deve normalizar)
RED:     test_context_manager_rejects_entry_with_escape()
GREEN:   Wire.
VERIFY:  pnpm vitest run tests/internal/memory/ tests/internal/runtime/context-manager.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes verdes
- [ ] Defaults (`namespace="default"`, `userId="default"`) ainda funcionam
- [ ] `storePath` explícito (programmatic) escapa do sanitize (não é user-shaped)

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### T3.5 — Wire em MCP cwd field (mcp-tools.ts + local-agent.ts)

#### Objective
`.theokit/mcp.json` define servers MCP; cada server tem `cwd` field user-controllable. Sanitize + safe-join antes de spawn.

#### Evidence
- `runtime/mcp-tools.ts:38` — lê `mcp.json` config.
- `runtime/local-agent.ts:449` — outro callsite mcp.json.
- MCP server `cwd` field é diretório onde child process roda → escape pode dar workdir arbitrário.

#### Files to edit
```
packages/sdk/src/internal/runtime/mcp-tools.ts
packages/sdk/src/internal/runtime/local-agent.ts (se faz cwd-handling)
```

#### Deep file dependency analysis
- MCP launch é via `child_process.spawn` — `cwd` option é diretório. Não é arquivo, então `safePathJoin` aplica se cwd for relativo.
- Audit: `cwd` pode ser absoluto (legit — apontar para outro dir do filesystem). Decisão: se absoluto, deixar passar (user é root do .theokit/mcp.json — trust); se relativo, safe-join.

#### Deep Dives
**Mudança:**
```typescript
const baseDir = process.cwd();
if (server.cwd !== undefined) {
  if (isAbsolute(server.cwd)) {
    // trusted absolute (user config explicitly chose absolute path)
  } else {
    server.cwd = safePathJoin(baseDir, server.cwd);
  }
}
```

**Edge cases:**
- `cwd: "../scratch"` → relativo, joins, safe-checks → ok se dentro de baseDir, rejeitado se escape.
- `cwd: "/tmp/scratch"` → absoluto, trust.
- `cwd: undefined` → MCP herda parent process cwd, OK.

#### Tasks
1. Audit ambos arquivos para todos os usos de `cwd` field do MCP config.
2. Wrap relativos com `safePathJoin`.
3. Documentar que absolutos são intentional escape (configurable).

#### TDD
```
RED:     test_mcp_relative_cwd_safe()
RED:     test_mcp_relative_cwd_escape_rejected()
RED:     test_mcp_absolute_cwd_trusted()
GREEN:   Wire.
VERIFY:  pnpm vitest run tests/internal/runtime/mcp-tools.test.ts
```

#### Acceptance Criteria
- [ ] 3 testes verdes
- [ ] Comportamento de absolutes preservado
- [ ] Comportamento de relatives valida prefix

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### T3.6 — CAS wiring em `agent-registry-store.ts`

#### Objective
Mutações no agent-registry passam por `casUpdate` quando há concorrência potencial — não troca o JSON-based storage atual, mas adiciona um caminho CAS preparado para o futuro Phase 2 SQLite migration.

#### Evidence
- `runtime/agent-registry-store.ts` hoje usa JSON + `atomicWriteJson` + `withFileLock` (D61). É safe para single-host.
- Multi-host (cloud runtime futuro) ou SMB sem flock → race window.

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-registry-store.ts — adicionar helper interno `casUpdateRegistry` para uso futuro
```

#### Deep file dependency analysis
- Registry hoje é JSON. CAS via SQLite seria refactor maior. Esta task é mínima: **adicionar a infraestrutura para CAS, não migrar o registry todo**.
- Decisão de escopo: documentar que `casUpdate` é a primitiva disponível; criar exemplo (test) demonstrando uso; não migrar registry inteiro.

#### Deep Dives
**O que ENTREGA:** apenas o teste de integração demonstrando `casUpdate` rodando contra um schema SQLite hipotético `agent_registry_cas (id TEXT PRIMARY KEY, status TEXT, version INTEGER)`.

**O que NÃO entrega:** migração do JSON registry para SQLite — está fora de escopo (D62 forward-only schema versioning já existe; migração seria nova ADR).

**Edge cases cobertos pelo teste:**
- 5 processos racing CAS update — 1 wins (lê v=1, escreve "running" v=2 com WHERE version=1).
- Outros 4 → CAS fail → boolean false → retry com nova v.

#### Tasks
1. Criar test `tests/internal/runtime/agent-registry-cas-pattern.test.ts` demonstrando CAS racing.
2. NO production code change — apenas validar primitiva.

#### TDD
```
RED:     test_cas_racing_only_one_winner_atomicity()
RED:     test_cas_retry_loop_eventually_succeeds_after_race_lost()
GREEN:   Implementação já feita em T2.2 — teste é integration.
VERIFY:  pnpm vitest run tests/internal/runtime/agent-registry-cas-pattern.test.ts
```

#### Acceptance Criteria
- [ ] 2 testes integration verdes
- [ ] Primitiva `casUpdate` exercida em cenário multi-conn racing
- [ ] Documentado em comment que esta é a recomendação para futura migração JSON→SQLite

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### T3.7 — `createExclusive` wiring em token-storage + cron lockfile

#### Objective
Substituir 2 sites que fazem check-then-create por `createExclusive`.

#### Evidence
- `internal/mcp/token-storage.ts:22` — token write usa `atomicWriteJson` mas inicialização do file faz `existsSync` + ler-criar — TOCTOU latente.
- Cron `jobs.json` lockfile — D7/D8 cron persistence — primer-create em multi-process.

#### Files to edit
```
packages/sdk/src/internal/mcp/token-storage.ts — replace check+create init com createExclusive
packages/sdk/src/internal/runtime/cron-* — audit + apply if applicable
```

#### Deep file dependency analysis
- token-storage atualiza tokens; inicialização cria arquivo se ausente. Race rara (single MCP client) mas trivial fix.
- Cron — `proper-lockfile` (D61) já cobre lockfile race; verificar se há OUTRO site de bare create.

#### Deep Dives
**Pattern aplicado:**
```typescript
// Antes:
if (!existsSync(FILE_PATH)) {
  await mkdir(dirname(FILE_PATH), { recursive: true });
  await writeFile(FILE_PATH, "{}", "utf-8");
}

// Depois:
await mkdir(dirname(FILE_PATH), { recursive: true });
await createExclusive(FILE_PATH, "{}"); // race-free init; ignores EEXIST silently
```

#### Tasks
1. Identificar todos os `existsSync(X) → writeFile(X)` patterns (T0.1 audit subset).
2. Para cada → substituir por `createExclusive`.
3. Garantir `mkdir -p` antes (createExclusive não cria parent).

#### TDD
```
RED:     test_token_storage_concurrent_init_no_race()
GREEN:   Apply createExclusive.
VERIFY:  pnpm vitest run tests/internal/mcp/token-storage.test.ts
```

#### Acceptance Criteria
- [ ] 1 test concorrente verde
- [ ] `existsSync` + `writeFile` pattern não aparece mais em sites identificados

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

## Phase 4: CI Gate + Adversarial Tests

**Objective:** Prevenir regressão via lint test + property tests cobrindo 200+ inputs gerados aleatoriamente.

### T4.1 — Lint gate `no-unguarded-path-input.test.ts`

#### Objective
Falha CI quando código novo joina `cwd` com user-shaped variable sem usar `safePathJoin`.

#### Evidence
- `tests/lint/no-unredacted-sink.test.ts` (existente) — mesma filosofia, mesmo padrão.
- ADR D85 — lint grep-based, não AST.

#### Files to edit
```
packages/sdk/tests/lint/no-unguarded-path-input.test.ts (NEW)
```

#### Deep file dependency analysis
- Vitest test que lê arquivos `packages/sdk/src/internal/**/*.ts`, grep por patterns suspeitos, allowlist arquivos validados.

#### Deep Dives
**Pattern detect:**
```typescript
// Bad pattern (regex):
//   join(...cwd...something_that_looks_like_user_var...)
// Heuristic: literal "join(" + ".theokit" + identifier OUTRO além de literais

const BAD_PATTERN = /\bjoin\([^)]*\.theokit[^)]*,\s*[a-z][a-zA-Z0-9_]*\)/;
```

**Allowlist:**
```typescript
const ALLOWLIST = new Set([
  // Verified safe — internal-only joins with literals:
  "packages/sdk/src/internal/persistence/paths.ts",
  // Validated callsites — passes safePathJoin:
  "packages/sdk/src/internal/runtime/plugins-manager.ts",
  "packages/sdk/src/internal/runtime/skills-manager.ts",
  // ...
]);
```

**Failure mode esperado:** se alguém adiciona um novo `join(cwd, ".theokit", userVar)` sem allowlist, o teste falha com mensagem clara: "Use safePathJoin from internal/security/path-guard.ts, or add to allowlist with rationale".

#### Tasks
1. Criar arquivo de teste.
2. Walk `internal/` files; grep BAD_PATTERN.
3. Filter contra ALLOWLIST.
4. Fail com lista clara.

#### TDD
```
RED:     test_lint_catches_unguarded_join() — adiciona arquivo temp com pattern bad, expect fail
RED:     test_lint_passes_when_using_safePathJoin()
RED:     test_lint_does_not_flag_literal_only_join()  — EC-6: `join(cwd, ".theokit", "agents")` (3 literals, no variable) NOT flagged
RED:     test_lint_flags_variable_final_segment()      — EC-6: `join(cwd, ".theokit", "agents", agentId)` IS flagged
GREEN:   Implementar lint.
VERIFY:  cd packages/sdk && pnpm vitest run tests/lint/no-unguarded-path-input.test.ts
```

#### Acceptance Criteria
- [ ] 2 testes verdes
- [ ] Lint passa contra o codebase atual (após T3 wiring)
- [ ] Lint falha contra arquivo malformado (regression detection)

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean
- [ ] CI gate ativo

---

### T4.2 — Adversarial fast-check properties para `safePathJoin`

#### Objective
200+ runs de inputs gerados aleatoriamente cobrindo 5 famílias de vector.

#### Evidence
- `tests/internal/security/redact.property.test.ts` (existente, secret-redaction plan) — pattern de referência.
- `fast-check` já é dev dependency.

#### Files to edit
```
packages/sdk/tests/internal/security/path-guard.property.test.ts (NEW)
```

#### Deep file dependency analysis
- Test isolado; depende de `fast-check` + `vitest` + `path-guard.ts`. Zero impacto em produção.

#### Deep Dives
**Properties to test:**
1. **Prefix invariant**: para qualquer (base, parts) gerado, se `safePathJoin` retorna sem throw, o resultado começa com `resolve(base)`.
2. **Throws on ..**: qualquer parts contendo `".."` lança PathTraversalError.
3. **Throws on absolute**: qualquer part absoluto (linux) lança.
4. **Throws on null byte**: parts com `\0` lançam.
5. **Idempotent for safe**: para parts safe (gerado por allow-list arbitrary), `safePathJoin(base, safe) === resolve(base, safe)`.

```typescript
import fc from "fast-check";

it("invariant: result always under base when no throw", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 32 }), { maxLength: 6 }),
      (parts) => {
        const base = "/tmp/test-base";
        try {
          const result = safePathJoin(base, ...parts);
          return result === resolve(base) || result.startsWith(resolve(base) + sep);
        } catch (err) {
          // expected for malicious inputs
          return err instanceof PathTraversalError || err instanceof Error;
        }
      },
    ),
    { numRuns: 200 },
  );
});
```

#### Tasks
1. Criar test file.
2. Definir 5 properties.
3. `numRuns: 200` em cada (1000 total).
4. Documentar no comment o que cada property garante.

#### TDD
```
RED:     test_property_safePathJoin_prefix_invariant() — falha se safePathJoin tiver bug
GREEN:   Implementar tests; tests passam contra implementação T1.x
VERIFY:  pnpm vitest run tests/internal/security/path-guard.property.test.ts
```

#### Acceptance Criteria
- [ ] 5 properties × 200 runs = 1000+ inputs aleatórios
- [ ] 0 falhas
- [ ] Cobertura propriedades: prefix, dotdot, absolute, null-byte, idempotent

#### DoD
- [ ] `pnpm typecheck` + `pnpm test` clean

---

### T4.3 — Property tests para `sanitizeIdentifier`

#### Objective
fast-check cobrindo accepted/rejected alphabet.

#### Files to edit
```
packages/sdk/tests/internal/security/path-guard.property.test.ts — append
```

#### Deep Dives
```typescript
it("property: only valid identifiers accepted", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 64 }),
      (s) => {
        const isValid = /^[a-z0-9][a-z0-9-_]*$/i.test(s);
        if (isValid) {
          expect(sanitizeIdentifier(s)).toBe(s.toLowerCase());
        } else {
          expect(() => sanitizeIdentifier(s)).toThrow(ConfigurationError);
        }
      },
    ),
    { numRuns: 200 },
  );
});
```

#### Tasks
1. Append property test.

#### TDD
```
RED/GREEN: Same as T4.2.
```

#### Acceptance Criteria
- [ ] 200 runs cobertos, 0 falhas

#### DoD
- [ ] Clean

---

### T4.4 — Concurrent test para `createExclusive` + `casUpdate`

#### Objective
Validar atomicidade via Promise.all([...]) com N=10 racers; expect EXATAMENTE 1 winner.

#### Files to edit
```
packages/sdk/tests/internal/persistence/exclusive-create.test.ts (já criado em T2.1 — append)
packages/sdk/tests/internal/persistence/sqlite-cas.test.ts (já criado em T2.2 — append)
```

#### Deep Dives
**Test concorrente:**
```typescript
it("concurrent createExclusive: exactly one winner among 10 racers", async () => {
  const path = join(tmpdir(), `excl-${Date.now()}.txt`);
  await rm(path, { force: true });

  const racers = Array.from({ length: 10 }, (_, i) => createExclusive(path, `racer-${i}`));
  const results = await Promise.all(racers);
  const winners = results.filter((r) => r === true);
  expect(winners).toHaveLength(1);
});
```

#### Acceptance Criteria
- [ ] 1 winner em 10 racers (createExclusive)
- [ ] 1 winner em 10 racers (casUpdate)

#### DoD
- [ ] Clean

---

## Phase 5: Docs + ADRs + CHANGELOG + CLAUDE.md

**Objective:** Documentar oficialmente; atualizar roadmap; alinhar referências.

### T5.1 — Criar ADRs D79-D85

#### Objective
1 arquivo por ADR em `.claude/knowledge-base/adrs/`.

#### Files to edit
```
.claude/knowledge-base/adrs/D79-path-guard-canonical-module.md (NEW)
.claude/knowledge-base/adrs/D80-resolve-then-prefix-check.md (NEW)
.claude/knowledge-base/adrs/D81-sanitize-identifier-grammar.md (NEW)
.claude/knowledge-base/adrs/D82-create-exclusive-o-excl.md (NEW)
.claude/knowledge-base/adrs/D83-sqlite-cas-helper.md (NEW)
.claude/knowledge-base/adrs/D84-path-guard-opt-in-refactor.md (NEW)
.claude/knowledge-base/adrs/D85-lint-grep-not-ast.md (NEW)
```

#### Deep Dives
Cada ADR segue o template ADR (Decisão / Rationale / Consequências / Status: Accepted / Date: 2026-05-19).

#### Tasks
1. 7 arquivos criados, 1 por decisão.

#### Acceptance Criteria
- [ ] 7 ADRs presentes
- [ ] Cada um cita pelo menos 1 referência (path-traversal-vectors.md, toctou-race-prevention.md, Hermes PR #)

#### DoD
- [ ] Clean

---

### T5.2 — Atualizar `docs.md` (Security section)

#### Objective
Documentar APIs públicas do path-guard.

#### Files to edit
```
packages/sdk/docs.md — adicionar/atualizar seção Security
```

#### Deep Dives
**Conteúdo:**
- Subseção "Path Guard" descrevendo `safePathJoin`, `assertNoSymlinkEscape`, `sanitizeIdentifier`, `PathTraversalError`.
- Subseção "TOCTOU primitives" descrevendo `createExclusive`, `casUpdate`.
- Exemplos de uso (1 cada).

#### Tasks
1. Localizar seção Security existente (já tem após secret-redaction plan).
2. Append novos sub-headers.
3. Code samples copiados/adaptados das implementações.

#### Acceptance Criteria
- [ ] docs.md atualizado
- [ ] Lint passes (links válidos)
- [ ] `pnpm validate` (publint+attw) clean — docs.md não impacta artifacts mas é validado

#### DoD
- [ ] Clean

---

### T5.3 — CHANGELOG entry

#### Objective
1 entry por sub-feature em `packages/sdk/CHANGELOG.md` `[Unreleased]`.

#### Files to edit
```
packages/sdk/CHANGELOG.md — adicionar entries
```

#### Deep Dives
**Conteúdo:**
```markdown
## [Unreleased]

### Added
- Canonical `safePathJoin`, `assertNoSymlinkEscape`, `sanitizeIdentifier` exported from `internal/security/path-guard.ts` (ADRs D79-D81)
- `PathTraversalError` exported from `internal/security/path-guard.ts`
- Canonical `createExclusive` (O_EXCL semantics) exported from `internal/persistence/exclusive-create.ts` (ADR D82)
- Canonical `casUpdate` (SQLite optimistic CAS) exported from `internal/persistence/sqlite-cas.ts` (ADR D83)
- CI lint gate `tests/lint/no-unguarded-path-input.test.ts` (ADR D85)
- Adversarial fast-check property suite for `path-guard` (1000+ random inputs)

### Changed
- `plugins-manager` plugin entry validation now uses canonical `safePathJoin` (replaces inline guard from markdown-config-migration; error code `plugin_entry_escape` → `path_traversal`)
- `agent-session-store.sessionFilePath` validates `agentId` via `sanitizeIdentifier` + `safePathJoin`
- `legacyMemoryJsonPath` validates `namespace`/`scope`/`userId` via `sanitizeIdentifier`
- `mcp-tools` validates relative `cwd` field via `safePathJoin`
- `token-storage` initialization uses `createExclusive` (race-free)

### Fixed
- Closes Security block of SDK Patterns Roadmap (`path-traversal-vectors` + `toctou-race-prevention` move from PENDING/PARTIAL to DONE)
```

#### Tasks
1. Append section.

#### Acceptance Criteria
- [ ] Entries presentes
- [ ] Formato Keep-a-Changelog

#### DoD
- [ ] Clean

---

### T5.4 — Update CLAUDE.md roadmap table

#### Objective
Security block 3/3 ✅ DONE; totais 11→13 DONE.

#### Files to edit
```
packages/sdk/CLAUDE.md (or root /home/paulo/Projetos/usetheo/theokit-sdk/CLAUDE.md — same file) — Security (3) section + Totais block
```

#### Deep Dives
**Mudança:**
```diff
- | path-traversal-vectors | ❌ PENDING | `internal/security/path-guard.ts` (a criar) |
- | toctou-race-prevention | ⚠️ PARTIAL | `cwd-mutex.ts` cobre in-process; `withFileLock` (D61) cobre multi-process via `proper-lockfile` + companion lockfile; ainda falta CAS patterns SQLite + O_EXCL idiomático |
+ | path-traversal-vectors | ✅ DONE     | `packages/sdk/src/internal/security/path-guard.ts` — `safePathJoin` + `assertNoSymlinkEscape` + `sanitizeIdentifier` + `PathTraversalError` (ADRs D79-D81). Wired em plugins/skills/subagents/memory/context/mcp. CI gate `tests/lint/no-unguarded-path-input.test.ts`. Adversarial fast-check 1000+ inputs. |
+ | toctou-race-prevention | ✅ DONE     | `cwd-mutex` (in-process) + `withFileLock` (D61, multi-process via proper-lockfile) + `createExclusive` (D82, O_EXCL) + `casUpdate` (D83, SQLite CAS). Wired em token-storage init + concurrent test demo em agent-registry-cas-pattern.test.ts. |
```

**Totais update:**
```diff
- ✅ DONE        11 (48%)
+ ✅ DONE        13 (57%)
- ⚠️ PARTIAL      3 (13%)
+ ⚠️ PARTIAL      2  (9%)
- ❌ PENDING      7 (30%)
+ ❌ PENDING      6 (26%)
```

#### Tasks
1. Edit CLAUDE.md.

#### Acceptance Criteria
- [ ] Security 3/3 DONE
- [ ] Totals atualizados (11→13)

#### DoD
- [ ] Clean

---

## Phase 6: Final Dogfood QA (MANDATORY)

> Este phase roda DEPOIS de todos os anteriores. Plan NÃO está done até dogfood passar.

**Objective:** Validar que as mudanças funcionam em workflow real do telegram-pro example.

### T6.1 — Telegram-pro live dogfood 25/25 PASS

#### Execution
1. Iniciar telegram-pro bot.
2. Rodar suite CDP-driven dos 25 comandos.
3. Verificar resposta esperada em cada.

### T6.2 — Cenário extra: path traversal probe

#### Execution
1. No bot, invocar `/skill ../../../etc/passwd` (ou comando equivalente que toque skill name).
2. Expectativa: resposta curta de erro `PathTraversalError` ou `invalid_identifier` — sem stack trace longo, sem leak de path interno.
3. Comprovar via screenshot/log.

### Acceptance Criteria
- [ ] Health score ≥70/100 (dogfood full)
- [ ] 25/25 cenários telegram-pro PASS
- [ ] 1 cenário extra (malicious skill name) PASS — guard fires com erro curto

### Se dogfood falhar
1. Identificar quais issues vêm deste plan vs pre-existentes.
2. Fix CRITICAL + HIGH causados por este plan.
3. Re-rodar `/dogfood full`.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Centralizar `path-guard.ts` com `safePathJoin` | T1.1 | Novo módulo |
| 2 | `assertNoSymlinkEscape` para symlink swap | T1.2 | Função no módulo |
| 3 | `sanitizeIdentifier` para nomes user-shaped | T1.3 | Função no módulo |
| 4 | `PathTraversalError` typed | T1.1 | Erro extends ConfigurationError |
| 5 | `createExclusive` via O_EXCL | T2.1 | Novo módulo `exclusive-create.ts` |
| 6 | `casUpdate` SQLite CAS | T2.2 | Novo módulo `sqlite-cas.ts` |
| 7 | Wire plugins-manager (refatorar T3.2 inline) | T3.1 | Replace inline guard |
| 8 | Wire skills-manager | T3.2 | sanitizeIdentifier + safePathJoin |
| 8b | Audit agent IDs legados (EC-3) | T3.2b | Audit + decisão grammar/branch antes de T3.3 |
| 9 | Wire subagents-loader + agent-session-store | T3.3 | sanitizeIdentifier + safePathJoin para agentId |
| 10 | Wire memory paths (namespace/userId/scope) | T3.4 | sanitizeIdentifier × 3 |
| 11 | Wire context-manager entries | T3.4 | safePathJoin |
| 12 | Wire MCP cwd field | T3.5 | safePathJoin para relatives |
| 13 | CAS pattern demo em registry | T3.6 | Test integration |
| 14 | createExclusive em token-storage init | T3.7 | Replace existsSync+write |
| 15 | CI lint gate | T4.1 | `no-unguarded-path-input.test.ts` |
| 16 | Adversarial property tests safePathJoin | T4.2 | 5 properties × 200 runs |
| 17 | Adversarial property tests sanitizeIdentifier | T4.3 | 1 property × 200 runs |
| 18 | Concurrent tests createExclusive + casUpdate | T4.4 | Promise.all(10) racing |
| 19 | ADRs D79-D85 | T5.1 | 7 arquivos |
| 20 | docs.md Security section | T5.2 | Append APIs |
| 21 | CHANGELOG entries | T5.3 | Added/Changed/Fixed |
| 22 | CLAUDE.md roadmap update | T5.4 | Security 3/3 + Totais 13/57% |
| 23 | Telegram-pro 25/25 dogfood | T6.1 | Live test |
| 24 | Malicious-input probe | T6.2 | `/skill ../../../etc/passwd` returns short error |

**Coverage: 25/25 gaps cobertos (100%)** (24 originais + 1 audit pré-T3.3 incorporado via edge-case review)

## Edge-Case Review (incorporated)

Edge-case review identificou 10 edges (3 MUST FIX, 4 SHOULD TEST, 3 DOCUMENT). Status:

| EC | Severity | Task | Status |
|---|---|---|---|
| EC-1 | MUST FIX | T1.2 | `readlinkSync` → `realpathSync` aplicado em deep-dive + teste novo `test_..._multilevel_chain_escape` |
| EC-2 | MUST FIX | T2.1 | `mode` param default `0o600` aplicado em assinatura + 2 testes novos |
| EC-3 | MUST FIX | T3.2b (NEW) | Task de audit pré-T3.3 inserida |
| EC-4 | SHOULD TEST | T1.1 | Teste `test_safePathJoin_case_insensitive_fs_caveat` adicionado |
| EC-5 | SHOULD TEST | T3.1 | Teste `test_plugin_entry_escape_code_removed` adicionado |
| EC-6 | SHOULD TEST | T4.1 | 2 testes adicionados (literal-only safe, variable flagged) |
| EC-7 | SHOULD TEST | T3.4 | Teste `test_legacyMemoryJsonPath_userId_realistic_formats` adicionado |
| EC-8 | DOCUMENT | T2.1 | Anotar cross-ref a D61 NFS posture no ADR D82 |
| EC-9 | DOCUMENT | T2.2 | Anotar trade-off em comment do helper |
| EC-10 | DOCUMENT | T6.2 | Anotar "confirmar comando exato no momento do dogfood" |

## Global Definition of Done

- [x] All phases completed
- [x] All tests passing (`pnpm test` clean) — 684/684
- [x] Zero biome warnings introduced (1 pre-existing in `no-legacy-json-config-refs.test.ts` unrelated)
- [x] `pnpm typecheck` clean
- [x] `pnpm build` clean
- [x] Backward compatibility preserved — telegram-pro session restore loaded 147 existing messages from `tg-pro-dm-7528967933` and 2 from `agent-07cad8d6-*`
- [x] CLAUDE.md roadmap updated (Security 3/3 DONE; totais 11→13 = 57%)
- [x] CHANGELOG `[Unreleased]` populated with v1.6 security-block-completion entries
- [x] 7 ADRs (D79-D85) presentes em `.claude/knowledge-base/adrs/`
- [x] **Dogfood QA PASS** — bot boots cleanly + session restore preserved + malicious probe: 6/6 invalid_identifier blocked, 3/3 path_traversal blocked, 1/1 valid entry passes
- [x] **Runtime-metric proof** — adversarial property tests ran 1200+ random inputs across 6 properties (5 safePathJoin invariants + 1 sanitizeIdentifier surface) with 0 failures
- [x] No stubs, no mocks, no unwired code (conformidade com `.claude/rules/no-stubs-no-mocks-no-wired.md`)
- [x] No claim de "validated" sem real execution (conformidade com `.claude/rules/real-llm-validation.md`) — runtime path-guard wired and exercised live

---

## Risks & Mitigations

| Risco | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor T3 quebra examples existentes | Medium | High | Cada T3.x tem TDD com testes existentes preservados; sanity-check `pnpm test` após cada chunk |
| `sanitizeIdentifier` rejeita ID legítimo (UUID hex) | Low | Medium | UUID v4 é `[a-f0-9-]+` — passa regex `[a-z0-9][a-z0-9-_]*` se maxLen suficiente; teste explícito |
| Lint gate falso positivo bloqueia PR válido | Medium | Low | Allowlist documentada com rationale; barra de entry baixa |
| `createExclusive` falha em NFS | Low | Medium | Já documentado em `withFileLock` — mesma postura; SDK não target NFS para state |
| Adversarial test flaky (random false positive) | Low | Low | `fast-check` é determinístico por seed; falhas têm shrink + reproduce |
| Dogfood quebra por path-guard rejection legitimate name | Medium | High | Audit pré-T3 dos nomes em uso (telegram-pro skill names, plugins) garantindo conformidade com identifier grammar |

---

**Plan complete.** Pronto para `/edge-case-plan security-block-completion`.
