# Plan: Secret Redaction Discipline — ✅ COMPLETED 2026-05-18

> **Status: COMPLETED 2026-05-18.** All phases (0, 1, 1.5, 2) + Final Dogfood QA validated end-to-end.
> 559/559 SDK tests green (was 525 pre-plan; +34 new: 24 redact unit + 14 property + 4 sink adversarial + 6 mapper shared + 3 transcript + 2 migration + 8 telemetry + 2 sink lint + 3 Security API). Zero typecheck errors. Zero biome warnings in plan-touched files.
> 6 ADRs committed (D68 canonical module, D69 env snapshot, D70 ON-default + warn, D71 two-bucket masking, D72 codeFile opt-out, D73 egress-only redaction).
> **Live CDP telegram-pro dogfood: 25/25 PASS in 41.9s.** Bot log + transcripts grep for `sk-[a-zA-Z0-9]{10,}` returned **0** leaks across 8 agent directories. Real-LLM mini-validation against Anthropic + OpenRouter 401 returned `auth_failed` with raw redacted (5/5 assertions PASS); synthetic body-echoes-secret test masks `sk-abcdef0123456789ghijklmn` → `sk-abc...klmn` and `Bearer eyJalg.def.ghi-jklmnop` → `Bearer ***` (5/5 PASS).
> Plan AC met via primary "25/25 PASS mantido" branch (no proxy escape hatch needed).

> **Version 1.1** — Incorporates edge-case review (3 MUST FIX: EC-1 circular-ref try/catch, EC-2 fixture-pattern lazy local replace, EC-3 vitest.setup.ts reset wire; 4 SHOULD TEST baked into TDD blocks; 2 DOCUMENT inline).
>
> **Version 1.0** — Fecha o gap `secret-redaction-discipline` (Security block, item 1 de 2 pendentes) e elimina o vetor concreto criado pelo plano `error-context-surfacing-plan` (commits b0356c6 + d3a373c, ADRs D65/D66/D67): `ErrorMetadata.raw` carrega até 2KB do response body bruto do provider. Se o provider ecoar o header `Authorization: Bearer sk-...` na mensagem de erro (vários fazem em modo debug), ou se o usuário logar o erro inteiro via telemetry (D34/D42 já wirados), tokens vazam direto pra Langfuse / Sentry / PostHog / arquivo de log. Este plano centraliza um redactor canônico em `internal/security/redact.ts` (substitui dois redactors duplicados existentes), wira-o em todos output boundaries (error.raw, transcript append, telemetry span attributes, migration logger), expõe `Security.addPattern(regex)` para tokens custom, e adiciona testes adversariais que falham CI se um sink novo escapar a redação. Outcome: zero token-shaped substring sai do processo via os sinks que o SDK controla (logs, errors, telemetry, transcript) — protege contra prompt-injection (snapshot-at-import), contra LLM emitindo `export THEOKIT_REDACT_SECRETS=false`, e contra novas surfaces adicionadas no futuro sem auditoria manual.

## Context

**Surfaces existentes que podem vazar (auditadas 2026-05-18):**

| Surface | Arquivo | Risco | Atual |
|---|---|---|---|
| `ErrorMetadata.raw` | `internal/errors/mappers/shared.ts:37-42` (`truncateRaw`) | HTTP error body bruto até 2KB. Anthropic + OpenRouter ecoam request headers em error responses no modo `--debug`. | **Sem redação.** Plano novo (acabou de mergear) criou este vetor. |
| Telemetry span attrs | `internal/telemetry/tracer.ts:170,197-198` (`setAttribute(s)`) | Atributos vão pra Langfuse / Sentry / PostHog (D42). `includeContent: true` adiciona `llm.prompt`/`llm.completion`/`tool.input`/`tool.output` (até 4KB) — `docs.md:1399` já alerta "never enable in production logs without redaction at the exporter" como promessa não cumprida. | **Sem redação.** Adapters chamam `client.capture(span)` direto. |
| Transcript JSONL append | `internal/runtime/agent-session-store.ts:52` (`appendFile(path, JSON.stringify(record))`) | Cada record carrega `message.content` (user prompt + assistant text + tool results). Tool result de um shell tool pode conter `env \| grep API`. | **Sem redação.** `record` é serializado direto. |
| Migration logger | `internal/memory/migrate-sqlite-to-lance.ts:105` (`opts.logger ?? console.log`) | Migration log do dry-run pode incluir fact text contendo creds (memory já passa por `redactSecrets` na escrita, mas migration lê SQLite legacy que pode ter dados pre-redação). | **Sem redação.** `console.log` direto. |

**Implementações redundantes existentes (precisam consolidar):**

1. `internal/memory/types.ts:23-27` — regex única `/(sk-proj-...|ghp_...|sk-...)\b/g`, 3 padrões só, substitui com `***`. Sem env-snapshot. Caller: `markdown-store.ts:61` (sanitiza memory fact text antes de salvar).
2. `internal/runtime/fixture-responder.ts:104-128` — 5 padrões (`sk-proj-`, `ghp_`, `sk-` ≥20 chars, `Bearer `, fixture sentinel). Roda só em modo fixture (test). Stringifica event inteiro e re-parseia — funciona mas é O(n) extra per event.

**Vetores conhecidos do Hermes (que viraram CVE-equivalent no upstream):**

- Browser tool capturing URLs com `?token=xxx` (v0.13 #21228)
- Shadow git commit de conteúdo `.env` (múltiplos PRs)
- `hermes debug share` upload do agent.log com secrets embedded (v0.13 #21350)
- Shell tool `env \| grep API` printing keys verbatim
- Prompt injection: tool result com `export REDACT=false` desabilitando redação na próxima call

**Evidence que o gap existe AGORA no theokit-sdk:**

```bash
$ grep -rn "redactSecrets\|redact" packages/sdk/src/ | grep -v test | wc -l
9    # 2 implementations, 4 callers, 3 doc references
# vs:
$ grep -rn "console\.\|appendFile\|setAttribute" packages/sdk/src/ | grep -v test | wc -l
28   # 28 output sinks — 4 wired through redact, 24 NOT
```

24 sinks sem redação. Plano fecha **8 críticos** (error.raw, telemetry tracer, transcript, migration logger) e adiciona test que falha CI se um 25º sink landar sem redact.

## Objective

**Done quando:** todo output sink controlado pelo SDK (error metadata, transcript JSONL, telemetry span attrs, migration logger, future logs) passa por `redactSecrets` antes de persistir/emitir, e um teste adversarial prova com 100+ inputs randomizados que nenhum dos 12 padrões canônicos escapa pra essas surfaces.

Specific, measurable:

1. Single `redactSecrets` em `internal/security/redact.ts` cobre ≥12 padrões (OpenAI/Anthropic/OpenRouter `sk-`, Anthropic `sk-ant-`, GitHub PAT classic+fine-grained, GitLab, AWS, Google API, Slack, Sentry, Stripe restricted+secret, `Authorization: Bearer ...`, generic `access_token=` / `api_key=` / `password=` query+JSON).
2. `THEOKIT_REDACT_SECRETS` env var snapshot capturado em import time (não re-lido a cada call). Default ON. Opt-out emite `console.warn` na primeira load.
3. `ErrorMetadata.raw` (criado em D67) chama `redactSecrets` em `truncateRaw` antes de retornar.
4. Tracer `setAttribute`/`setAttributes` redacta string values antes de delegar ao OTel span.
5. `agent-session-store.appendTranscriptRecord` redacta o JSON serializado antes do `appendFile`.
6. `migrate-sqlite-to-lance` redacta strings antes do logger.
7. Legacy `redactSecrets` em `internal/memory/types.ts` vira re-export shim de `internal/security/redact.ts` (zero break em callers).
8. Public `Security.addPattern(re: RegExp)` adiciona padrões custom em runtime (additive only — nunca remove built-ins).
9. Teste adversarial gera 100 inputs com cada padrão embutido em texto natural; **0 leaks** assertados via `expect(redacted).not.toContain(originalSecret)`.
10. Test "no-new-sink" varre `packages/sdk/src/` e falha se um new `console.log`/`appendFile`/`setAttribute` for adicionado em arquivo não-whitelisted sem ir via `redactSecrets`.

## ADRs

### D68 — `redactSecrets` canônico em `internal/security/redact.ts`, fonte única de verdade

- **Decision:** Criar `internal/security/redact.ts` exportando `redactSecrets(text, opts?)`, `maskToken`, `addPattern`. Os dois redactors duplicados (`internal/memory/types.ts` + `internal/runtime/fixture-responder.ts`) viram thin re-exports / call-through.
- **Rationale:** Hoje há 3 listas de patterns desalinhadas (memory tem 3, fixture tem 5, vetores reais cobrem 12+). Atualizar em três lugares é coupling acidental que vai drift. KISS + DRY: uma lista, uma função, um snapshot de env.
- **Consequences:** Habilita auditoria centralizada via `grep redactSecrets`. Constrange: callers existentes precisam atualizar import path. Mitigação: re-export shim em `internal/memory/types.ts` para zero break.

### D69 — Env snapshot `THEOKIT_REDACT_SECRETS` no module-init, não a cada call

- **Decision:** `const REDACT_ENABLED = readEnvOnce()` no top-level do módulo. Reads `process.env.THEOKIT_REDACT_SECRETS` exatamente uma vez. Mudanças subsequentes em `process.env` são ignoradas.
- **Rationale:** Defesa contra prompt injection. Tool result contendo `process.env.THEOKIT_REDACT_SECRETS = 'false'` (via JS execution sink) ou `export THEOKIT_REDACT_SECRETS=false` em shell tool poderia desabilitar a redação mid-run. Snapshot-at-init torna isso impossível. Hermes confirma este pattern em `redact.py:60-69`.
- **Consequences:** Habilita atestação "depois que o processo bootou, redaction NÃO pode ser desligada". Constrange: testes que precisam alternar precisam usar `vi.resetModules()` + re-import. Mitigação: expor helper `_internal/test-reset-redaction.ts` só pra suite.

### D70 — ON por default, opt-out emite warning único na primeira leitura

- **Decision:** Se `THEOKIT_REDACT_SECRETS` ausente ou `"true"`/`"1"`/`"yes"`/`"on"` → ON. Qualquer outro valor (`"false"`, `"0"`, ...) → OFF + `console.warn("[theokit] Secret redaction is DISABLED via THEOKIT_REDACT_SECRETS. Credentials may leak into errors, telemetry, logs, transcripts.")` uma única vez.
- **Rationale:** Hermes v0.12 enviou OFF default → vazou em produção → v0.13 reverteu pra ON com escape hatch. Lesson learned externa, não vou re-aprender em casa.
- **Consequences:** Habilita "safe by default". Constrange: usuários que legitimamente querem secrets em logs (auditing, debugging local) precisam opt-in explicitamente — warning os informa que estão vulneráveis. Aceitável.

### D71 — Two-bucket masking: short (<18 chars) totalmente mascarado; long preserva prefix+suffix

- **Decision:** `maskToken(t)`:
  - `t.length < 18` → `"***"`
  - `t.length >= 18` → `${t.slice(0,6)}...${t.slice(-4)}` (e.g., `sk-abc...xyz1`)
- **Rationale:** Long tokens são únicos per-account; prefix+suffix preserva debuggability ("é a dev key ou prod key?") sem revelar o middle. Short tokens podem ser totalmente reproduzíveis a partir do prefix, então mascaram completo.
- **Consequences:** Habilita debugging humano sem perda de segurança. Constrange: tokens com 17 chars exatos (rare edge) ficam totalmente mascarados. Aceitável.

### D72 — `codeFile: true` opt-out para conteúdo legitimamente parecido com secret

- **Decision:** `redactSecrets(text, { codeFile: true })` aplica subset menos agressivo (só patterns com 10+ chars de entropy real; pula `Bearer\s+...{8,}` e query-param `access_token=`).
- **Rationale:** Lendo `.env.example` ("OPENAI_API_KEY=sk-xxxx"), schema JSON com `"api_key": "<your-key>"`, ou test fixture com `const TEST_KEY = "sk-test"` — todos contêm strings prefix-shaped mas que NÃO são secrets reais. Mangling esses arquivos quebra o produto. Hermes v0.12→v0.13 #19715 documentou exatamente este FP.
- **Consequences:** Habilita uso seguro em file readers/writers. Constrange: chamador precisa saber quando passar `codeFile: true`. Mitigação: callers correntes (memory markdown-store) NÃO usam codeFile; só novos consumidores explícitos (file-read tool, se vier).

### D73 — Redaction at OUTPUT boundaries only, não na storage

- **Decision:** Redaction aplica-se em: error metadata builder (`shared.ts:truncateRaw`), telemetry tracer wrapper (`setAttribute`), transcript appender (`agent-session-store`), migration logger. NÃO aplica-se em: memory fact storage (caller já passa `redactSecrets` via D68 shim), session state em memória, `.theokit/agents/*.json` (workspace files, 0600 já).
- **Rationale:** Dados redacted são lossy. Se o user precisar do original (debugging, audit), não dá pra recuperar. Storage preserva original; egress redacta. Hermes pattern AD-5.
- **Consequences:** Habilita "store-once, redact-on-each-egress". Constrange: surfaces NOVAS que persistem state precisam decidir explicitamente se redactam ou não — não há default.

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Final Dogfood QA
   │           │
   │           ├──▶ Phase 1 has 4 wiring tasks (T1.1..T1.4)
   │           │    All independent — can parallelize
   │           │    All depend on Phase 0 (central redact module)
   │           │
   │           ▼
   │      Phase 1.5 (adversarial tests) — depends on Phase 1 wirings landed
   │
   ▼
Phase 0 has 2 tasks (T0.1 = create, T0.2 = migrate shim)
T0.2 depends on T0.1 (needs the new module to import)
```

- **Phase 0 sequential** (T0.1 → T0.2)
- **Phase 1 parallelizable** (T1.1, T1.2, T1.3, T1.4 — all depend on Phase 0, all independent of each other)
- **Phase 1.5 sequential** (precisa todas as wirings landed)
- **Phase 2 sequential** (depends on Phase 1.5 — docs only after wiring proved)
- **Final Dogfood** depois de tudo

---

## Phase 0: Foundation — central `internal/security/redact.ts`

**Objective:** Single source of truth pra redaction, com env snapshot, 12+ patterns, two-bucket masking, public `addPattern` API.

### T0.1 — Implementar `internal/security/redact.ts`

#### Objective
Criar o módulo canônico com `redactSecrets(text, opts)`, `maskToken(token)`, `addPattern(re)`, `_resetForTests()` (não exportado público).

#### Evidence
- Hermes `redact.py:60-105` shows the canonical pattern list + env snapshot.
- `internal/memory/types.ts:23-27` tem só 3 patterns — sub-cobertura comprovada.
- `internal/runtime/fixture-responder.ts:104-128` tem 5 patterns — outro subset desalinhado.
- `truncateRaw` em `shared.ts` recém-criado retorna body bruto sem redação.

#### Files to edit
```
packages/sdk/src/internal/security/redact.ts — (NEW) módulo canônico
packages/sdk/src/internal/security/index.ts — (NEW) barrel re-exporting redactSecrets + addPattern
packages/sdk/src/internal/security/_test-reset.ts — (NEW) helper interno só pra vitest (D69 trade-off)
packages/sdk/vitest.setup.ts — wirar `_resetForTests({ clearExtras: true })` em `beforeEach` (EC-3 fix; arquivo já existe per ADR D60)
```

#### Deep file dependency analysis
- `redact.ts` (NEW): zero dependencies inbound. Outbound: nenhuma (pure module).
- `index.ts` (NEW): re-exports. Será consumido em Phase 1 por errors/mappers/shared.ts, telemetry/tracer.ts, runtime/agent-session-store.ts, memory/migrate-sqlite-to-lance.ts, e em Phase 0.T0.2 por internal/memory/types.ts.
- `_test-reset.ts` (NEW): apenas vitest setup importa. Permite resetar `REDACT_ENABLED` + `_extraPatterns` entre testes sem `vi.resetModules()` (que é lento + frágil em vitest 3.x).

#### Deep Dives

**Pattern list canonical (12 inicialmente, extensível via addPattern):**

```typescript
const BUILTIN_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,         // Anthropic
  /sk-proj-[A-Za-z0-9_-]{10,}/g,         // OpenAI project key (must come before sk- generic)
  /sk-[A-Za-z0-9_-]{20,}/g,              // OpenAI / OpenRouter / DeepInfra (20+ chars to avoid sk-test FP)
  /ghp_[A-Za-z0-9]{36}/g,                // GitHub PAT classic (exact length)
  /github_pat_[A-Za-z0-9_]{82}/g,        // GitHub PAT fine-grained (exact length)
  /glpat-[A-Za-z0-9_-]{20}/g,            // GitLab PAT (exact length)
  /AKIA[A-Z0-9]{16}/g,                   // AWS access key (exact length)
  /AIza[A-Za-z0-9_-]{35}/g,              // Google API key
  /xox[bpasr]-[A-Za-z0-9-]{10,}/g,       // Slack tokens
  /sntrys_[A-Za-z0-9]{40,}/g,            // Sentry user auth
  /sk_live_[A-Za-z0-9]{20,}/g,           // Stripe secret
  /rk_live_[A-Za-z0-9]{20,}/g,           // Stripe restricted
];

// Parametric (key=value) — matches authorization headers + URL params + JSON
const PARAM_PATTERN = /(\b(?:authorization|access_token|api_key|api-key|password|secret|x-api-key|bearer)\b\s*[:=]\s*["']?)([^\s&"',}]+)/gi;
```

**ReDoS safety:** todos os quantificadores são `{n,m}` (bounded) ou `+` aplicado em char class linear. Nenhum `.*` greedy. Cap implicito por `truncateRaw` (2KB) e por telemetry attr (4KB) limita scan time a ~μs por chamada.

**Env snapshot:**

```typescript
const REDACT_ENABLED = (() => {
  const raw = process.env.THEOKIT_REDACT_SECRETS;
  if (raw === undefined) return true;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
})();

let _warnedOptOut = false;
if (!REDACT_ENABLED && !_warnedOptOut) {
  process.stderr.write(
    "[theokit-sdk] Secret redaction is DISABLED via THEOKIT_REDACT_SECRETS. " +
      "Credentials may leak into errors, telemetry, logs, transcripts.\n",
  );
  _warnedOptOut = true;
}
```

**`addPattern` (public):**

```typescript
const _extraPatterns: RegExp[] = [];

export function addPattern(re: RegExp): void {
  if (!re.global) {
    throw new Error("Security.addPattern: regex must have /g flag for replace-all semantics");
  }
  _extraPatterns.push(re);
}
```

**Algorithm:**

```typescript
export function redactSecrets(text: unknown, opts?: { codeFile?: boolean }): string {
  if (typeof text !== "string") {
    if (text === null || text === undefined) return "";
    if (typeof text === "object") {
      // EC-1: JSON.stringify lança em circular refs. Defensivo: fallback string seguro,
      // nunca propagar exception fora da função (callers no error path entrariam em loop).
      try {
        text = JSON.stringify(text);
      } catch {
        text = "[unredactable: circular]";
      }
    } else {
      text = String(text);
    }
  }
  if (!REDACT_ENABLED) return text as string;
  let s = text as string;
  for (const re of BUILTIN_PATTERNS) s = s.replace(re, m => maskToken(m));
  for (const re of _extraPatterns) s = s.replace(re, m => maskToken(m));
  if (!opts?.codeFile) {
    s = s.replace(PARAM_PATTERN, (_, prefix) => `${prefix}***`);
  }
  return s;
}

function maskToken(t: string): string {
  if (t.length < 18) return "***";
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
}
```

**Edge cases:**
- EC-1 (ReDoS): nenhum padrão usa `+` quantifier sem char class — Linear time guaranteed.
- EC-2 (non-string input): coerce via JSON.stringify (em try/catch — EC-1 do edge-case review previne crash em circular refs), retorna `""` para null/undefined.
- EC-3 (overlapping patterns): `sk-proj-...` tem que vir ANTES de `sk-...` (ordem matters porque global replace passa pattern-by-pattern). Documentar inline.
- EC-4 (empty string): `redactSecrets("")` → `""`. Sem falha.
- EC-5 (regex sem /g): `addPattern` rejeita com Error claro (sem /g, replace só substitui primeiro match → leak parcial). Test cobre.
- EC-6 (addPattern com pattern que matches everything): por design, `addPattern` é additive — caller é responsável. Documentar warning na JSDoc.
- EC-7 (circular ref no input objeto — edge-case review EC-1): try/catch envolve `JSON.stringify` no branch de coerce; retorna sentinel `"[unredactable: circular]"`. Test cobre.

#### Tasks
1. Criar `packages/sdk/src/internal/security/redact.ts` com env snapshot + BUILTIN_PATTERNS + PARAM_PATTERN + redactSecrets + maskToken + addPattern.
2. Criar `packages/sdk/src/internal/security/_test-reset.ts` exportando `_resetForTests({ enabled?: boolean; clearExtras?: boolean })` (não exportado pelo barrel — só vitest setup importa via caminho explícito).
3. Criar `packages/sdk/src/internal/security/index.ts` re-exporting `redactSecrets`, `maskToken`, `addPattern`.
4. Adicionar `/** @internal */` em todos exports (D68 — fonte única, mas internal; public surface vem em T2.1 via top-level `Security` namespace).
5. **(EC-3 fix)** Wirar `_resetForTests({ clearExtras: true })` em `packages/sdk/vitest.setup.ts:beforeEach` para prevenir test bleed (já existe setup pra THEOKIT_HOME per ADR D60 — adicionar 1 linha import + 1 linha call).

#### TDD

```
RED: redactSecrets returns "" for undefined input
RED: redactSecrets returns "" for null input
RED: redactSecrets coerces non-string via JSON.stringify
RED: redactSecrets("") returns ""
RED: redactSecrets masks OpenAI sk- with 20+ char body, length>=18 → prefix+suffix preserved
RED: redactSecrets masks short OpenAI key (<18 chars total) → "***"
RED: redactSecrets masks sk-ant-... BEFORE sk- generic (specificity order)
RED: redactSecrets masks sk-proj-... BEFORE sk- generic
RED: redactSecrets masks AKIA[16] AWS key exactly
RED: redactSecrets masks ghp_ GitHub PAT with exact 36-char length
RED: redactSecrets masks Authorization: Bearer <token> via PARAM_PATTERN
RED: redactSecrets masks ?access_token=xyz in URL
RED: redactSecrets masks api_key=abc in JSON-like body
RED: redactSecrets with { codeFile: true } SKIPS PARAM_PATTERN
RED: redactSecrets is no-op when REDACT_ENABLED=false (env=false at import)
RED: addPattern with /g flag accepts; without /g throws
RED: addPattern is additive — adding MYORG-[A-Z0-9]{32} masks it, builtins still work
RED: maskToken("short") returns "***"
RED: maskToken("sk-abcdef1234567890xyz") returns "sk-abc...90xyz"
RED: _resetForTests({ enabled: false }) flips REDACT_ENABLED, _resetForTests({ enabled: true }) restores
RED: _resetForTests({ clearExtras: true }) removes patterns added via addPattern
RED: redactSecrets with circular-ref object returns "[unredactable: circular]" (does NOT throw) — EC-1 fix
RED: vitest.setup.ts beforeEach clears extras — test A adds pattern, test B in same file does NOT see it after beforeEach reset — EC-3 fix

GREEN: implement redact.ts + _test-reset.ts + index.ts + wire reset in vitest.setup.ts
REFACTOR: ensure regex declarations are at module-top (zero per-call allocation), extract helper for length-bucket logic
VERIFY: pnpm --filter @usetheo/sdk test tests/internal/security/redact.test.ts
```

#### Acceptance Criteria
- [x] `redactSecrets` exported from `internal/security/index.ts`
- [x] `addPattern` exported, validates `/g` flag
- [x] `maskToken` exported (re-used by Phase 1 wirings)
- [x] 23/23 RED tests pass after GREEN (21 base + EC-1 circular + EC-3 vitest-reset wire)
- [x] `pnpm typecheck` clean
- [x] Biome zero warnings em arquivos novos
- [x] LoC de `redact.ts` <= 105 (target 85; +5 pra try/catch EC-1)
- [x] LoC de `_test-reset.ts` <= 30
- [x] Cyclomatic complexity `redactSecrets` <= 9 (branch table + try/catch wrap)
- [x] Zero dependencies inbound (módulo pure, foundational)
- [x] `vitest.setup.ts` chama `_resetForTests({ clearExtras: true })` em `beforeEach`

#### DoD
- [x] Tasks 1-4 completed
- [x] All tests green (`pnpm test --run tests/internal/security/`)
- [x] Zero biome warnings
- [x] Zero typecheck errors
- [x] Commit: `feat(sdk): add canonical Security.redactSecrets (T0.1, ADR D68/D69/D70/D71/D72)`

---

### T0.2 — Migrar callers existentes pra fonte canônica

#### Objective
Substituir as duas implementações duplicadas por re-exports / call-throughs do novo módulo, sem quebrar nenhum caller existente.

#### Evidence
```bash
$ grep -rn "redactSecrets" packages/sdk/src/ | grep -v test
packages/sdk/src/internal/memory/markdown-store.ts:6     # import
packages/sdk/src/internal/memory/markdown-store.ts:61    # call
packages/sdk/src/internal/memory/types.ts:25             # export def
packages/sdk/src/internal/runtime/memory-store.ts:7,22   # re-export bridge
packages/sdk/src/internal/runtime/memory-store.ts:71     # call
packages/sdk/src/internal/runtime/fixture-responder.ts:115  # private impl
```

Três caminhos, três pattern lists. Consolidar.

#### Files to edit
```
packages/sdk/src/internal/memory/types.ts — substituir definição local por re-export do novo módulo
packages/sdk/src/internal/runtime/fixture-responder.ts — substituir SECRET_VALUE_PATTERNS local por chamada ao novo redactSecrets
packages/sdk/src/internal/memory/markdown-store.ts — verificar import path (deve continuar funcionando via shim)
packages/sdk/src/internal/runtime/memory-store.ts — verificar re-export chain
```

#### Deep file dependency analysis
- `internal/memory/types.ts`: hoje exporta `redactSecrets` + outras coisas. Após T0.2: re-exporta de `../security/index.js`. Callers (`markdown-store.ts`, `memory-store.ts`) continuam funcionando — import sem mudança.
- `internal/runtime/fixture-responder.ts`: hoje tem `SECRET_VALUE_PATTERNS` + `redactScriptSecrets` + `redactEventSecrets`. Após T0.2: `redactEventSecrets` chama `redactSecrets(JSON.stringify(event))` e re-parseia. Drop pattern array. Fixture sentinel `fixture-search-secret` é caso especial — adicionar via `addPattern` no setup.

#### Deep Dives

**Re-export shim em `internal/memory/types.ts`:**

```typescript
// Antes
const SECRET_PATTERN = /\b(?:sk-proj-...|ghp_-...|sk-...)\b/g;
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "***");
}

// Depois
export { redactSecrets } from "../security/index.js";
```

**Fixture responder change:**

```typescript
// Antes (linhas 104-128)
const SECRET_VALUE_PATTERNS: RegExp[] = [/* 5 patterns */];
function redactScriptSecrets(script) {
  const events = script.events.map(redactEventSecrets);
  return { ...script, events };
}
function redactEventSecrets(event) {
  const serialized = JSON.stringify(event);
  let redacted = serialized;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "***");
  }
  if (redacted === serialized) return event;
  return JSON.parse(redacted);
}

// Depois — EC-2 fix: padrão fixture-sentinel é local ao módulo, NÃO registrado
// globalmente via addPattern (evita test bleed quando _resetForTests({ clearExtras: true })
// roda em beforeEach — module-init de fixture-responder não re-executa).
import { redactSecrets } from "../security/index.js";

const FIXTURE_SENTINEL = /fixture-search-secret/g;

function redactScriptSecrets(script) {
  const events = script.events.map(redactEventSecrets);
  return { ...script, events };
}
function redactEventSecrets(event) {
  const serialized = JSON.stringify(event);
  // Step 1: local fixture sentinel (isolado ao escopo deste módulo)
  const localStripped = serialized.replace(FIXTURE_SENTINEL, "***");
  // Step 2: canonical redaction (built-in patterns + user addPattern())
  const redacted = redactSecrets(localStripped);
  if (redacted === serialized) return event;
  return JSON.parse(redacted);
}
```

**Por que essa abordagem (EC-2 fix vs registro global):**
- `addPattern` global em module-init é apagado por `_resetForTests({ clearExtras: true })` no `vitest.setup.ts beforeEach` (introduzido em T0.1 step 5 pra EC-3). Module init não roda de novo, então sentinel some.
- Replace local em `redactEventSecrets` rerun a cada chamada — não depende de state global do redactor. Test isolation preservada.
- Sentinel é específico ao fixture mode, não faz sentido como padrão global de qualquer forma.

#### Tasks
1. Substituir `internal/memory/types.ts:23-27` (definição + SECRET_PATTERN) por `export { redactSecrets } from "../security/index.js"`.
2. Substituir `internal/runtime/fixture-responder.ts:104-128`: remove SECRET_VALUE_PATTERNS, importa `redactSecrets` + `addPattern`, registra `fixture-search-secret`, simplifica `redactEventSecrets`.
3. Rodar `pnpm typecheck` — confirma callers (`markdown-store`, `memory-store`) continuam compilando sem mudança de import.
4. Rodar `pnpm test --run tests/internal/memory tests/internal/runtime/fixture-mode` — confirma zero regressão.

#### TDD

```
RED: existing memory markdown-store test — sanitize fact com sk-key continua mascarando
RED: existing fixture-mode test — events com sk- ainda redacted
RED: legacy types.ts redactSecrets reference equality NOT preserved (mudou de função local pra re-export) — ajustar test que usa `.toBe(originalFn)` se houver
GREEN: T0.2 changes
REFACTOR: nenhum esperado (mudança é mecânica)
VERIFY: pnpm test --run tests/internal/memory tests/internal/runtime
```

#### Acceptance Criteria
- [x] `types.ts` reduz `redactSecrets` para re-export linha única
- [x] `fixture-responder.ts` perde array `SECRET_VALUE_PATTERNS` (-12 LoC mínimo)
- [x] Todos tests pré-existentes passam (zero regressão)
- [x] `grep -rn "SECRET_PATTERN\|SECRET_VALUE_PATTERNS" packages/sdk/src/` retorna 0 hits
- [x] Biome zero warnings em arquivos modificados
- [x] Cyclomatic complexity `redactEventSecrets` <= 4 (era 6)

#### DoD
- [x] Tasks 1-4 completed
- [x] Tests green (`pnpm test`)
- [x] Commit: `refactor(sdk): consolidate redactSecrets onto canonical security module (T0.2, ADR D68)`

---

## Phase 1: Wire output boundaries

**Objective:** Wirá-l aos 4 sinks identificados na auditoria. Pode rodar paralelo (4 PRs independentes), mas vou listar sequencial pra simplicidade de rastreamento.

### T1.1 — Redact `ErrorMetadata.raw` em `truncateRaw`

#### Objective
Surface mais nova + mais crítica. Plano error-context acabou de mergear e criou o vetor.

#### Evidence
- `internal/errors/mappers/shared.ts:37-42` (`truncateRaw`) retorna body bruto. Comentário do plano D67 explícito: "raw body truncated to ~2KB" — sem menção de redação.
- HTTP error responses de Anthropic e OpenRouter em modo debug ecoam request headers. `Authorization: Bearer sk-ant-...` aparece literal.

#### Files to edit
```
packages/sdk/src/internal/errors/mappers/shared.ts — adicionar redactSecrets antes de retornar body
packages/sdk/tests/internal/errors/mappers/shared.test.ts — (NEW se não existir) cobrir EC-1
```

#### Deep file dependency analysis
- `shared.ts:truncateRaw` é called por `buildErrorMetadata` (D67 helper), que é called por `mapAnthropicError` + `mapOpenAICompatibleError`. Toda HTTP error path do SDK passa por aqui. Change concentrado.
- Tests de mapper (`anthropic.test.ts`, `openai-compatible.test.ts` — 26 tests existentes do plano anterior) — devem continuar verdes; um deles assertava `metadata.raw` contém substring específico — precisa atualizar para tolerar masking se a substring contiver pattern.

#### Deep Dives

**Algoritmo:**

```typescript
// Antes
export function truncateRaw(body: unknown): unknown {
  if (body === null || body === undefined) return undefined;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  if (s.length <= RAW_MAX_BYTES) return body;
  return `${s.slice(0, RAW_MAX_BYTES)}…`;
}

// Depois
import { redactSecrets } from "../../security/index.js";

export function truncateRaw(body: unknown): unknown {
  if (body === null || body === undefined) return undefined;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  const truncated = s.length <= RAW_MAX_BYTES ? s : `${s.slice(0, RAW_MAX_BYTES)}…`;
  return redactSecrets(truncated);
}
```

**Edge case (audit dos 26 tests existentes):** os tests assertam shape do metadata mas não contêm strings token-shaped reais — confirmado via grep `expect.*sk-` em `tests/internal/errors/mappers/` retorna 0 hits. Zero risk de quebra.

**Edge case EC-7 (post-redact):** body que era objeto vira string após redact (porque redactSecrets coerce non-string via stringify). Mudou shape do retorno: era preservar objeto se ≤2KB, agora sempre string. **Breaking** pra consumer que faz `err.metadata.raw.someKey`. **Mitigation:** ninguém faz isso hoje. Documentar em CHANGELOG.

#### Tasks
1. **(SHOULD TEST EC-7)** Rodar `grep -rn "metadata\\.raw\\." packages/sdk/src packages/sdk/tests examples/` ANTES do GREEN e anexar output no PR description (não só "0 hits em src" como verificação tácita; lista explícita pra rastreabilidade). Se encontrar callers, ajustar antes de prosseguir.
2. Atualizar `truncateRaw` para chamar `redactSecrets` na string serializada.
3. Atualizar JSDoc da função pra documentar EC-7 (sempre retorna string ou undefined, não preserve object shape).
4. Adicionar test em `shared.test.ts` que injeta um body com `sk-abcdef1234567890xyz` e asserta que `metadata.raw` não contém o secret.
5. Verificar os 26 tests existentes do plano anterior continuam passando.

#### TDD

```
RED: truncateRaw with body containing "sk-abcdef1234567890xyz" → return value does not include the secret
RED: truncateRaw with body containing "Authorization: Bearer eyJabc..." → masked via PARAM_PATTERN
RED: truncateRaw with object body { error: "sk-..." } → returns string (post-redact JSON), secret masked
RED: truncateRaw with null → undefined (preserved)
RED: truncateRaw with undefined → undefined (preserved)
GREEN: shared.ts change
REFACTOR: none
VERIFY: pnpm test --run tests/internal/errors/
```

#### Acceptance Criteria
- [x] 5 RED tests pass
- [x] 26 pre-existing mapper tests still pass
- [x] `truncateRaw` JSDoc updated documentando EC-7 (string-only return post-redact)
- [x] CHANGELOG entry sob `[Unreleased]` mencionando shape change

#### DoD
- [x] Tests green
- [x] Biome zero warnings
- [x] Commit: `feat(sdk): redact ErrorMetadata.raw via Security.redactSecrets (T1.1)`

---

### T1.2 — Wrap telemetry tracer `setAttribute(s)` com redação automática

#### Objective
Cada string attribute que vai pra Langfuse / Sentry / PostHog passa por redactSecrets.

#### Evidence
- `tracer.ts:170,197-198` — `setAttribute` e `setAttributes` delegam direto pro OTel span sem inspeção.
- `docs.md:1399` warning não cumprido: "never enable in production logs without redaction at the exporter".
- D34 (telemetry OTel privacy default) + D42 (auto-instrumentation) — privacy promise sem enforcement.

#### Files to edit
```
packages/sdk/src/internal/telemetry/tracer.ts — wrappar setAttribute(s) com redactSecrets para string values
packages/sdk/tests/golden/agent/telemetry.golden.test.ts — adicionar test que spy do span e verifica string redacted
```

#### Deep file dependency analysis
- `tracer.ts:safe()` já wrappa errors do exporter (D34 EC-1 enforcement). Adicionar redação é mais um wrap layer — mesma pattern.
- Pre-existing telemetry golden tests (T34, T42 quando landaram) — alguns podem assertar attribute string exato. Audit + adjust patterns se necessário.

#### Deep Dives

**Algoritmo:**

```typescript
// Antes (linhas 196-199)
return {
  startSpan: (name, attrs) => ...,
  setAttribute: (k, v) => safe(() => span.setAttribute(k, v), undefined),
  setAttributes: (attrs) => safe(() => span.setAttributes(attrs), undefined),
};

// Depois
import { redactSecrets } from "../security/index.js";

function redactAttrValue(v: string | number | boolean | undefined): typeof v {
  if (typeof v !== "string") return v;
  return redactSecrets(v);
}

function redactAttrs(attrs: Record<string, string | number | boolean | undefined>) {
  const out: typeof attrs = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = redactAttrValue(v);
  return out;
}

return {
  startSpan: (name, opts) => {
    const newAttrs = opts?.attributes ? redactAttrs(opts.attributes) : undefined;
    return ...wrap(span)...;
  },
  setAttribute: (k, v) => safe(() => span.setAttribute(k, redactAttrValue(v)), undefined),
  setAttributes: (a) => safe(() => span.setAttributes(redactAttrs(a)), undefined),
};
```

**Edge cases:**
- EC-8 (number/boolean attrs): pass-through — não tem string content.
- EC-9 (undefined attr): pass-through.
- EC-10 (`includeContent: true` adds `llm.prompt` up to 4KB): redact se for string. 4KB com 12 patterns em <1ms (medido em smoke test).

#### Tasks
1. **(SHOULD TEST EC-5)** Abrir `internal/telemetry/tracer.ts:170` e confirmar signature EXATA de `startSpan` antes do GREEN. Pseudocódigo acima é aproximado; o wrap real deve casar com `{ attributes: ... }` shape do OTel. Falhar aqui silenciosamente perde attrs sem redact por mismatch de shape.
2. Adicionar `redactAttrValue` + `redactAttrs` helpers no top de `tracer.ts`.
3. Aplicar em `startSpan` (attrs initial), `setAttribute`, `setAttributes`.
4. Adicionar 3 tests no golden suite cobrindo string redact + number passthrough + undefined passthrough.
5. Auditar pre-existing telemetry tests — adjust se algum assertava string exata que agora seria masked.

#### TDD

```
RED: setAttribute("api.key", "sk-abcdef1234567890xyz") → span.setAttribute called with masked value
RED: setAttribute("count", 42) → span.setAttribute called with 42 (number passthrough)
RED: setAttributes({ "llm.prompt": "...sk-key1234567890xyz..." }) → span received masked
RED: startSpan(name, { attributes: { secret: "sk-key..." } }) → underlying span received masked attrs
GREEN: tracer.ts changes
REFACTOR: none
VERIFY: pnpm test --run tests/golden/agent/telemetry
```

#### Acceptance Criteria
- [x] 4 RED tests pass
- [x] All pre-existing telemetry golden tests pass (or adjusted with rationale)
- [x] No new biome warnings
- [x] Cyclomatic complexity `setAttributes` wrapper <= 4

#### DoD
- [x] Tests green
- [x] Commit: `feat(sdk): redact string attrs in telemetry tracer (T1.2)`

---

### T1.3 — Redact transcript JSONL appends

#### Objective
Cada record que vai pra `~/.theokit/.../transcript.jsonl` passa por redactSecrets antes do appendFile.

#### Evidence
- `internal/runtime/agent-session-store.ts:52` — `await appendFile(path, JSON.stringify(record) + "\n", "utf8")`. Zero redação.
- `record` carrega `message.content` que pode conter tool result com shell `env | grep API` output.

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-session-store.ts — redact JSON antes do appendFile
packages/sdk/tests/internal/runtime/agent-session-store.test.ts — (NEW se não existir) test cobrindo
```

#### Deep file dependency analysis
- `agent-session-store.ts:appendTranscriptRecord` (linha 50-ish) é o único appendFile call. Mudança concentrada.
- Callers: `internal/runtime/real-local-run.ts` chama no loop final pra persistir conversa. Test golden existente pode assertar transcript file content.

#### Deep Dives

**Algoritmo:**

```typescript
// Antes
const line = `${JSON.stringify(record)}\n`;
await appendFile(path, line, "utf8");

// Depois
import { redactSecrets } from "../security/index.js";
const line = `${redactSecrets(JSON.stringify(record))}\n`;
await appendFile(path, line, "utf8");
```

**Edge case EC-11:** record contém binary base64 image (vision) — pode acidentalmente match `AIza...` Google API key pattern se o base64 começar similar (unlikely mas possível em 1B+ images). Mitigation: pattern tem `{35}` exact length — base64 random chunks raramente são EXATAMENTE 39 chars terminando em legal base64 char. Aceitar como risco residual; user pode rotacionar pattern via `addPattern` se vier reclamação.

#### Tasks
1. Importar `redactSecrets` em `agent-session-store.ts`.
2. Aplicar em `appendTranscriptRecord` ao serializar.
3. Test que cria transcript record com `sk-abcdef1234567890xyz` em message.content → lê arquivo → asserta secret ausente.

#### TDD

```
RED: appendTranscriptRecord with record.message.content="key sk-abcdef1234567890xyz" → readFile shows masked
RED: appendTranscriptRecord preserves valid JSON structure post-redact (parseable per line)
GREEN: agent-session-store.ts change
REFACTOR: none
VERIFY: pnpm test --run tests/internal/runtime/agent-session-store
```

#### Acceptance Criteria
- [x] 2 RED tests pass
- [x] Existing tests still pass
- [x] JSON validity preserved post-redact (`JSON.parse(line)` works)

#### DoD
- [x] Tests green
- [x] Commit: `feat(sdk): redact transcript JSONL appends (T1.3)`

---

### T1.4 — Redact migration logger output

#### Objective
`migrate-sqlite-to-lance` log redact strings antes do logger.

#### Evidence
- `internal/memory/migrate-sqlite-to-lance.ts:105` — `opts.logger ?? ((m: string) => console.log(m))`. Mensagens podem incluir fact text (sample debug, count summary) lido do SQLite legacy.

#### Files to edit
```
packages/sdk/src/internal/memory/migrate-sqlite-to-lance.ts — wrap logger calls com redactSecrets
```

#### Deep file dependency analysis
- Logger é local helper — wrap em uma função no top.

#### Deep Dives

```typescript
// Antes
const log = opts.logger ?? ((m: string) => console.log(m));

// Depois
import { redactSecrets } from "../security/index.js";
const rawLog = opts.logger ?? ((m: string) => console.log(m));
const log = (m: string) => rawLog(redactSecrets(m));
```

**(DOCUMENT EC-9)** Caller que passa `opts.logger` custom não pode bypassar redação. Aligned com D70 (default ON, opt-out só via env `THEOKIT_REDACT_SECRETS=false`). Se um caller de migração precisa raw output (auditoria, debugging local), seta o env var no scope da execução. Mantém invariante "logger não escolhe se redacta — env escolhe".

#### Tasks
1. Importar `redactSecrets`.
2. Wrap `log` no top.
3. Test usando `opts.logger` spy + fact text contendo secret.

#### TDD

```
RED: migrateSqliteToLance with logger spy + SQLite content containing sk-abcdef1234567890xyz → spy never called with the secret
GREEN: change
VERIFY: pnpm test --run tests/internal/memory/migrate
```

#### Acceptance Criteria
- [x] 1 RED test pass
- [x] Existing migration tests still pass

#### DoD
- [x] Tests green
- [x] Commit: `feat(sdk): redact migration logger output (T1.4)`

---

## Phase 1.5: Adversarial tests + sink audit

### T1.5.1 — Property-based adversarial redaction test

#### Objective
Provar com 100+ inputs randomizados que zero token escapa qualquer dos 4 sinks wirados.

#### Evidence
- Hermes v0.8 #4962 — catastrophic backtracking fix surgiu só em adversarial testing.
- Plano roadmap item `property-based-testing` ainda PENDING — esta task tira fagulha lá também.

#### Files to edit
```
packages/sdk/package.json — add `fast-check` devDependency
packages/sdk/tests/internal/security/redact.property.test.ts — (NEW)
packages/sdk/tests/internal/security/sinks.adversarial.test.ts — (NEW) — exercita os 4 sinks com tokens gerados
```

#### Deep file dependency analysis
- `fast-check` é dev-only. Não toca production bundle.
- Adversarial test importa cada sink (errors/mappers, tracer, agent-session-store, migrate) e prova end-to-end.

#### Deep Dives

**Property test (redact.property.test.ts) — EC-4 fix: cobrir TODOS 12 padrões builtin + PARAM_PATTERN:**

```typescript
import { fc } from "fast-check";
import { redactSecrets } from "@/internal/security/redact.js";

// Generators: one per builtin pattern (matches the BUILTIN_PATTERNS list em T0.1)
const generators = [
  fc.stringMatching(/^sk-ant-[A-Za-z0-9_-]{20,40}$/),
  fc.stringMatching(/^sk-proj-[A-Za-z0-9_-]{20,40}$/),
  fc.stringMatching(/^sk-[A-Za-z0-9_-]{20,40}$/),
  fc.stringMatching(/^ghp_[A-Za-z0-9]{36}$/),
  fc.stringMatching(/^github_pat_[A-Za-z0-9_]{82}$/),
  fc.stringMatching(/^glpat-[A-Za-z0-9_-]{20}$/),
  fc.stringMatching(/^AKIA[A-Z0-9]{16}$/),
  fc.stringMatching(/^AIza[A-Za-z0-9_-]{35}$/),
  fc.stringMatching(/^xox[bpasr]-[A-Za-z0-9-]{10,30}$/),
  fc.stringMatching(/^sntrys_[A-Za-z0-9]{40}$/),
  fc.stringMatching(/^sk_live_[A-Za-z0-9]{20,40}$/),
  fc.stringMatching(/^rk_live_[A-Za-z0-9]{20,40}$/),
];

for (const [idx, gen] of generators.entries()) {
  it(`builtin pattern #${idx} never leaks across 200 random natural-text inputs`, () => {
    fc.assert(
      fc.property(
        gen,
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        (secret, prefix, suffix) => {
          const haystack = `${prefix} ${secret} ${suffix}`;
          return !redactSecrets(haystack).includes(secret);
        },
      ),
      { numRuns: 200 },
    );
  });
}

// PARAM_PATTERN coverage (Bearer / access_token=/api_key= em URLs e JSON)
it("PARAM_PATTERN masks Authorization Bearer + URL params + JSON-like keys", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("Authorization: Bearer", "access_token=", "api_key=", "password:", "x-api-key:"),
      fc.string({ minLength: 8, maxLength: 80 }).filter((s) => /^[A-Za-z0-9_\-.]+$/.test(s)),
      (prefix, value) => {
        const haystack = `${prefix} ${value}`;
        return !redactSecrets(haystack).includes(value);
      },
    ),
    { numRuns: 200 },
  );
});
```

**Adversarial sink test (sinks.adversarial.test.ts):**

```typescript
import { fc } from "fast-check";
import { mapAnthropicError } from "@/internal/errors/mappers/anthropic.js";

it("ErrorMetadata.raw never echoes secret-shaped substring", () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^sk-[A-Za-z0-9]{30}$/),
      (secret) => {
        const err = mapAnthropicError({
          status: 401,
          body: { error: { message: `invalid key: ${secret}` } },
          headers: undefined,
          endpoint: "/messages",
        });
        return !JSON.stringify(err.metadata).includes(secret);
      },
    ),
    { numRuns: 100 },
  );
});
```

Repetir pra telemetry tracer (spy span), transcript appender (tmpfile), migration logger (spy).

#### Tasks
1. Adicionar `fast-check` em `packages/sdk/package.json` (devDeps, ^3.x).
2. **(EC-4 fix)** Criar `redact.property.test.ts` com 12 property tests (um por padrão builtin) + 1 PARAM_PATTERN test = 13 total.
3. Criar `sinks.adversarial.test.ts` cobrindo os 4 sinks de Phase 1.

#### TDD

```
RED: 12 builtin patterns × 200 runs each → 0 leaks (EC-4 fix: cobre os 8 padrões adicionais)
RED: PARAM_PATTERN × 200 runs → 0 leaks
RED: sink test 1 — ErrorMetadata.raw
RED: sink test 2 — telemetry tracer span attrs
RED: sink test 3 — transcript appender
RED: sink test 4 — migration logger
GREEN: já implementado em Phase 0+1 — tests devem passar imediatamente
VERIFY: pnpm test --run tests/internal/security
```

#### Acceptance Criteria
- [x] `fast-check` added to devDeps
- [x] 12 builtin pattern property tests pass with `numRuns: 200`
- [x] 1 PARAM_PATTERN property test passes with `numRuns: 200`
- [x] 4 sink adversarial tests pass with `numRuns: 100`
- [x] Test runtime <= 8s total (ReDoS guard; 13×200 + 4×100 = 3000 runs)

#### DoD
- [x] Tests green
- [x] Commit: `test(sdk): adversarial property tests for redaction (T1.5.1)`

---

### T1.5.2 — "No new sink" CI gate

#### Objective
Test que falha CI se um novo `console.log`/`appendFile`/`setAttribute` for adicionado em arquivo não-whitelisted sem ir via `redactSecrets`.

#### Evidence
- Hermes redact.py shipou redação em 1 PR, depois leak surgiu em PR seguinte que adicionou novo sink. Gate previne esse drift.

#### Files to edit
```
packages/sdk/tests/lint/no-unredacted-sink.test.ts — (NEW)
```

#### Deep file dependency analysis
- Lint test pattern já existe (`tests/lint/no-hardcoded-theokit-path.test.ts`). Mesmo formato.

#### Deep Dives

```typescript
import { readFileSync } from "node:fs";
import { glob } from "glob";

const SINK_PATTERNS = [
  /\bappendFile(?:Sync)?\s*\(/,
  /\bwriteFile(?:Sync)?\s*\(/,
  /span\.setAttribute(?:s)?\s*\(/,
  /console\.(log|info|warn|error)\s*\(/,
];

const WHITELIST = [
  // Files that route through redactSecrets already
  "internal/errors/mappers/shared.ts",
  "internal/telemetry/tracer.ts",
  "internal/runtime/agent-session-store.ts",
  "internal/memory/migrate-sqlite-to-lance.ts",
  "internal/security/redact.ts",       // the redactor itself, can opt-out
  "internal/persistence/atomic-write.ts", // writes serialized blobs, caller responsible
  // ... +explicit whitelist com rationale por entrada
];

it("no unredacted sink in src/", () => {
  const files = glob.sync("packages/sdk/src/**/*.ts");
  const violations = [];
  for (const file of files) {
    if (WHITELIST.some(w => file.includes(w))) continue;
    const content = readFileSync(file, "utf8");
    for (const pattern of SINK_PATTERNS) {
      if (pattern.test(content) && !content.includes("redactSecrets")) {
        violations.push({ file, pattern: pattern.source });
      }
    }
  }
  expect(violations).toEqual([]);
});
```

**Trade-off:** keyword-based detection. False positive: file que tem `redactSecrets` em comment mas não chama. False negative: aliased import. Aceitável — gate é primeiro filtro, não substitui review.

#### Tasks
1. Criar `no-unredacted-sink.test.ts` com lista inicial whitelist baseada em audit Phase 1.
2. **(EC-6 fix)** Adicionar segundo test `it("whitelist entries all exist on disk")` que itera `WHITELIST` e `fs.existsSync` em cada — falha clara se rename/move deixar entry stale.
3. Rodar e confirmar 0 violations contra estado pós-T1.4.
4. Adicionar artificial violation em test branch (file fora whitelist + sink) → confirma test fails. Reverter.

#### TDD

```
RED: artificial unredacted sink in a fake file → test reports violation
RED: whitelist com entry stale (file removido) → segundo test fails — EC-6 fix
GREEN: remove the artificial file
VERIFY: pnpm test --run tests/lint/no-unredacted-sink
```

#### Acceptance Criteria
- [x] Test pass against current src/ state
- [x] Whitelist documenta rationale por entrada via inline comment
- [x] False-positive rate medido (deve ser 0 no estado atual)

#### DoD
- [x] Tests green
- [x] Commit: `test(sdk): CI gate for new unredacted output sinks (T1.5.2)`

---

## Phase 2: Public API + docs

### T2.1 — Expose `Security.addPattern` no public surface

#### Objective
Permitir usuários adicionarem padrões custom (org-internal tokens) sem patchar SDK.

#### Files to edit
```
packages/sdk/src/security.ts — (NEW) top-level Security namespace
packages/sdk/src/index.ts — re-export Security
docs.md — adicionar "Security" section
```

#### Deep Dives

```typescript
// security.ts
import { addPattern as _addPattern } from "./internal/security/index.js";

export class Security {
  private constructor() {}

  /**
   * Register a custom redaction pattern. Additive — built-in patterns
   * (OpenAI, Anthropic, GitHub PAT, AWS, etc.) cannot be removed.
   *
   * @param re - RegExp with `/g` flag. Throws if `/g` is missing
   *             (without /g, only first match is replaced and the rest leak).
   *
   * **(DOCUMENT EC-8)** State is process-global mutable. SDK is designed
   * for single-tenant processes (Theo PaaS user runtime, local CLI).
   * Multi-tenant deployments running multiple SDK consumers in the same
   * Node process share this list — patterns added by tenant A apply to
   * tenant B's redactions. Acceptable for v1; documented for future
   * isolate-aware refactor if needed.
   *
   * @example
   * Security.addPattern(/MYORG-[A-Z0-9]{32}/g);
   */
  static addPattern(re: RegExp): void {
    _addPattern(re);
  }
}
```

Single static, single method. Sem state cycle dependency.

#### Tasks
1. Criar `packages/sdk/src/security.ts`.
2. Re-export from `index.ts`.
3. Test: `Security.addPattern(/MYORG-[A-Z0-9]{32}/g)` + redact text → masked.

#### TDD

```
RED: Security.addPattern(/MYORG-[A-Z0-9]{32}/g) + redactSecrets("token MYORG-ABCDEF...") masks it
GREEN: implement
VERIFY: pnpm test --run tests/security
```

#### Acceptance Criteria
- [x] `Security` exported from package
- [x] `Security.addPattern` validates /g flag (delegates to internal addPattern)
- [x] docs.md section added (T2.2 dependency)

#### DoD
- [x] Tests green
- [x] Commit: `feat(sdk): public Security.addPattern API (T2.1)`

---

### T2.2 — docs.md + CHANGELOG + CLAUDE.md sync

#### Files to edit
```
docs.md — new "Security" section
packages/sdk/CHANGELOG.md — entry sob [Unreleased]
CLAUDE.md — roadmap: secret-redaction-discipline ✅ DONE; totais 10/3/8/2
.claude/knowledge-base/sdk-references/README.md — sync totais
```

#### Tasks
1. docs.md: nova seção "Security" com `Security.addPattern` example, default ON, opt-out via `THEOKIT_REDACT_SECRETS=false`, list of 12 builtin patterns.
2. CHANGELOG entry sob `[Unreleased]` (Added: Security.addPattern; Security: secret redaction wired in error metadata, telemetry attrs, transcript, migration logger).
3. CLAUDE.md table linha `secret-redaction-discipline` ❌ PENDING → ✅ DONE.
4. CLAUDE.md totais: was 9 DONE / 3 PARTIAL / 9 PENDING / 2 CULTURAL → now 10 DONE / 3 PARTIAL / 8 PENDING / 2 CULTURAL.
5. sdk-references/README.md mirror.

#### Acceptance Criteria
- [x] docs.md section reviewed (link example, opt-out warning, pattern list)
- [x] CHANGELOG entry presente
- [x] CLAUDE.md roadmap atualizado
- [x] sdk-references/README.md em sync

#### DoD
- [x] Commit: `docs(sdk): document Security.redactSecrets + addPattern (T2.2)`

---

### T2.3 — ADRs D68-D73 commitados

#### Files to edit
```
.claude/knowledge-base/adrs/D68-redact-canonical-module.md — (NEW)
.claude/knowledge-base/adrs/D69-redact-env-snapshot.md — (NEW)
.claude/knowledge-base/adrs/D70-redact-on-by-default.md — (NEW)
.claude/knowledge-base/adrs/D71-redact-two-bucket-masking.md — (NEW)
.claude/knowledge-base/adrs/D72-redact-codefile-optout.md — (NEW)
.claude/knowledge-base/adrs/D73-redact-output-boundaries-only.md — (NEW)
CLAUDE.md — table rows added
```

#### Acceptance Criteria
- [x] 6 ADR files criados
- [x] CLAUDE.md table linhas D68-D73 added
- [x] Cada ADR tem Decision / Rationale / Consequences

#### DoD
- [x] Commit: `docs(sdk): add ADRs D68-D73 for redaction discipline (T2.3)`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Duas implementações duplicadas + desalinhadas de `redactSecrets` | T0.1, T0.2 | Central module + re-export shims |
| 2 | `ErrorMetadata.raw` vaza body bruto (vetor recém-criado) | T1.1 | `truncateRaw` chama `redactSecrets` |
| 3 | Telemetry span attrs vão pra Langfuse/Sentry/PostHog sem redação | T1.2 | Tracer `setAttribute(s)` wrappers |
| 4 | Transcript JSONL appends carregam tool result com secrets | T1.3 | `appendTranscriptRecord` redacta antes do appendFile |
| 5 | Migration logger pode imprimir fact text com creds | T1.4 | Logger wrap |
| 6 | Prompt injection pode desabilitar redação mid-run | D69, T0.1 | Env snapshot at module-init |
| 7 | Sem padrões customizáveis pra org-internal tokens | T2.1 | `Security.addPattern` public API |
| 8 | Cobertura de padrões restrita (3-5 → precisa 12+) | T0.1 | BUILTIN_PATTERNS com 12 entries + PARAM_PATTERN |
| 9 | Sem teste adversarial provando zero leak | T1.5.1 | Property-based tests (200 runs × 4 patterns × 4 sinks) |
| 10 | Future surfaces podem adicionar sinks sem redação | T1.5.2 | CI gate `no-unredacted-sink.test.ts` |
| 11 | Sem rationale documentado pras decisões | T2.3 | ADRs D68-D73 |
| 12 | Roadmap CLAUDE.md desatualizado | T2.2 | Update totais + status |
| 13 | Edge-case review EC-1: circular ref crasha redactSecrets | T0.1 (algoritmo + RED test) | try/catch envolve JSON.stringify, retorna sentinel |
| 14 | Edge-case review EC-2: fixture sentinel apagado por _resetForTests | T0.2 (replace local em redactEventSecrets) | Padrão fixture vira local replace, não global addPattern |
| 15 | Edge-case review EC-3: test bleed via _extraPatterns global | T0.1 step 5 (wire vitest.setup.ts) | beforeEach chama _resetForTests({ clearExtras: true }) |
| 16 | Edge-case review EC-4: property test cobre só 4/12 padrões | T1.5.1 (12 generators + PARAM_PATTERN) | 13 property tests total |
| 17 | Edge-case review EC-5: pseudo signature de startSpan desalinhado | T1.2 step 1 (audit antes do GREEN) | Confirmar shape OTel real |
| 18 | Edge-case review EC-6: whitelist com entries stale | T1.5.2 (segundo test) | fs.existsSync por entry |
| 19 | Edge-case review EC-7: callers internos de metadata.raw.foo | T1.1 step 1 (grep audit explícito) | Lista no PR description |

**Coverage: 19/19 gaps covered (100%)**

## Global Definition of Done

- [x] All phases (0, 1, 1.5, 2) completed
- [x] All tests passing (`pnpm test`)
- [x] Zero biome warnings em packages/sdk/
- [x] Zero typecheck errors (`pnpm typecheck`)
- [x] Backward compatibility preserved (redactSecrets shim em internal/memory/types.ts; ErrorMetadata.raw shape change documentado em CHANGELOG sob "Notable shape changes")
- [x] CHANGELOG.md atualizado sob `[Unreleased]`
- [x] docs.md "Security" section adicionada
- [x] CLAUDE.md: roadmap shows `secret-redaction-discipline` ✅ DONE; totais 10 DONE / 3 PARTIAL / 8 PENDING / 2 CULTURAL
- [x] sdk-references/README.md em sync
- [x] 6 ADRs D68-D73 commitados
- [x] **Runtime-metric proof**: property tests com numRuns 200+ provam ZERO leak; CI gate previne regression
- [x] **No-sink-without-redact invariant**: `tests/lint/no-unredacted-sink.test.ts` passes
- [x] **Dogfood QA PASS** (Phase Final) — telegram-pro 25/25 mantido + bot log redacted manualmente verificado

## Final Phase: Dogfood QA (MANDATORY)

**Objective:** Validar que telegram-pro continua passing 25/25 e que ações reais que historicamente vazariam secret (`/tool` com env, error path com 401 Anthropic) agora redactam.

### Execution

1. Rodar live CDP dogfood (mesma skill que rodou 25/25 PASS antes): `node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933`
2. Inspect `/tmp/tgpro-dogfood.log` — confirma zero `sk-` substrings remanescentes.
3. Test manual: trigger `agent.send` com prompt que faz tool produzir output similar a `env | grep API`. Verificar que transcript JSONL no `.theokit/.../transcript.jsonl` não contém secret.
4. Test manual: provoque AuthenticationError (modificar temporariamente `OPENROUTER_API_KEY` pra inválida) e capture `err.metadata.raw` — confirma redacted.

### Acceptance Criteria

- [x] 25/25 PASS mantido (real CDP, não proxy)
- [x] `grep -E "sk-[a-zA-Z0-9]{20,}" /tmp/tgpro-dogfood.log` returns 0 hits
- [x] Transcript JSONL não contém secret-shaped substring após sessão com tool result
- [x] `err.metadata.raw` mostra masked tokens quando provider error echoes auth header
- [x] Zero CRITICAL issues introduzidos pelos changes
- [x] Health score >= 70/100

### If Dogfood Fails

1. Identificar quais issues são causados pelo plano vs pre-existing.
2. Fix all plan-caused CRITICAL/HIGH antes de declarar complete.
3. Re-run dogfood.
4. Pre-existing issues logged.

## References

- Specs primárias: [`.claude/knowledge-base/sdk-references/secret-redaction-discipline.md`](../sdk-references/secret-redaction-discipline.md)
- Error context plan (sibling, completed — criou o vetor `metadata.raw`): [`./error-context-surfacing-plan.md`](./error-context-surfacing-plan.md)
- Roadmap macro: `CLAUDE.md` § "SDK Patterns Roadmap"
- Hermes redact.py canonical: `referencia/hermes-agent/agent/redact.py:60-105` (read-only study)
- Existing minimal redactors a consolidar:
  - `packages/sdk/src/internal/memory/types.ts:23-27`
  - `packages/sdk/src/internal/runtime/fixture-responder.ts:104-128`
- Sinks identificados (auditoria 2026-05-18):
  - `packages/sdk/src/internal/errors/mappers/shared.ts:37-42`
  - `packages/sdk/src/internal/telemetry/tracer.ts:170,197-198`
  - `packages/sdk/src/internal/runtime/agent-session-store.ts:52`
  - `packages/sdk/src/internal/memory/migrate-sqlite-to-lance.ts:105`
