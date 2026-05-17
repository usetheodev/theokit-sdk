# Plan: Agent Construction DX Helpers (getOrCreate + factory + defineTool + builder)

> **STATUS: COMPLETO — todas 7 phases concluídas, 331/331 testes verdes, validate (G1-G9) passou exit=0, dogfood real-LLM no telegram-pro confirmado via messages.jsonl persistido (UUID v4 + SHA256 real + 2026 timestamp).**

> **Version 1.0** — Quatro helpers públicos no `@usetheo/sdk` para abstrair a construção de agentes: `Agent.getOrCreate(id, options)` mata a boilerplate de resume-or-create (vista em 6 examples hoje); `createAgentFactory(common)` captura config compartilhada para chat-bot patterns (per-session forking); `defineTool(spec)` dá tipagem Zod-driven e remove `as Record<string, unknown>` casts em definições de tool; `Agent.builder()` oferece fluent-chain alternativo ao options-bag para quem prefere construção progressiva. Outcome: telegram-pro encolhe ~80 LoC, os 5 outros examples removem ~30 LoC cada, defineTool elimina type-cast unsafety em `ad-hoc-tools.ts`, e a public API surface ganha pontos de entrada claros para os 3 padrões mais comuns (one-shot, factory, fluent).

## Context

**Estado atual (após commit `102d928`):**

- `Agent.create(options)` e `Agent.resume(id, options)` são os únicos pontos de entrada.
- 6 examples replicam a mesma boilerplate de `try { Agent.resume } catch (UnknownAgentError) { Agent.create }`: `telegram-pro/src/agent.ts`, `telegram-bot/src/index.ts`, `resume-agent/src/index.ts`, `agent-management/src/index.ts`, `error-handling/src/index.ts`, `error-handling-full/src/index.ts`.
- Custom tools (commit `3582788`) exigem `inputSchema: Record<string, unknown>` literal e `handler: (input: Record<string, unknown>) => string | Promise<string>` — não há inferência de tipos. `examples/telegram-pro/src/ad-hoc-tools.ts` faz 4 type-casts `as RollInput` / `as Base64Input` / etc no início de cada handler.
- `AgentOptions` tem 13 campos top-level (`model`, `apiKey`, `name`, `systemPrompt`, `local`, `cloud`, `mcpServers`, `agents`, `agentId`, `context`, `providers`, `plugins`, `skills`, `memory`, `tools`). Em `telegram-pro/src/agent.ts:120-154` a chamada de create ocupa 35 linhas só de configuração.
- Zod já é peer dep declarado (`packages/sdk/CLAUDE.md` toolchain table: "Zod peer dep ^3.25 || ^4").

**Por que isso importa agora:**

- Cada example novo adicionado ao catálogo paga o mesmo imposto de boilerplate (~30 LoC só para resume-or-create + ~10 LoC de config repetida).
- Os type-casts em ad-hoc-tools.ts são `as`-coerced — se o LLM enviar um JSON com `count: "three"` em vez de número, o handler trava com `Number("three") → NaN` sem erro tipado.
- Sem builder/factory, consumidores indecisos copiam código entre projetos em vez de compor — fragilidade de manutenção.

**Referências:**

- Commit `3582788` (custom tools)
- Commit `cd96e5a` (LocalAgent split)
- Commit `102d928` (dedup agent-lookup)
- `examples/telegram-pro/src/agent.ts` (caso piloto)
- `examples/telegram-pro/src/ad-hoc-tools.ts` (caso piloto defineTool)

## Objective

**Done = todos os 4 helpers shipados na public API, testados com LLM real, e 6 examples refatorados para usar pelo menos um helper cada.**

Metas mensuráveis:

1. `Agent.getOrCreate(id, options)`: estática no `Agent`, 100% type-compatível com `Agent.create()` (mesma `AgentOptions`); 6 examples migram (zero try/catch `UnknownAgentError` restante).
2. `createAgentFactory(common)`: função exportada do barrel; expõe `.forSession(id, overrides?)`; deep-merge correto de `local`, `memory`, `cloud`; telegram-pro `getAgent()` cai de 64 LoC para <30 LoC.
3. `defineTool(spec)`: função genérica com Zod schema → tipo inferido em TS; `ad-hoc-tools.ts` migra 5 tools (uuid, roll, base64, hash, timezone) sem casts `as`.
4. `Agent.builder()`: classe `AgentBuilder` com chains `.model()`, `.local()`, `.memory()`, `.tools()`, `.systemPrompt()`, `.build()` (retorna `AgentOptions`), `.create()` (chama `Agent.create`), `.getOrCreate(id)` (chama `Agent.getOrCreate`); cobertura E2E com LLM real via stub Anthropic.
5. Suite 303 → ~334 (4 helpers × ~6 tests + race test + 3 edge case tests + 3 example refactor tests).
6. Telegram bot dogfooded: `/tool`, `current_time`, memory, `/loop` continuam funcionando após refactor.

## ADRs

### D22 — `Agent.getOrCreate` semantics

- **Decisão**: `Agent.getOrCreate(agentId, options)` tenta `Agent.resume(agentId, options)` primeiro; se `UnknownAgentError`, chama `Agent.create({ ...options, agentId })`. Re-throw qualquer outra exceção. NÃO é atomic — entre o `resume` e o `create`, outro processo pode ter registrado o mesmo agentId (EC-1).
- **Rationale**: Igualar o que os 6 examples já fazem manualmente. Não introduz atomicity porque a registry é per-cwd e a documentação de D17 já marca "one SDK process per cwd" como limitação aceita.
- **Consequências**: Habilita migração 1-pra-1 dos examples. Race entre processos continua sendo edge case documentado (mesma fronteira do D17). Não há overhead novo no happy path (resume continua sendo single hot path).

### D23 — `createAgentFactory` merge strategy

- **Decisão**: A factory captura `common: Partial<AgentOptions>` e expõe `.forSession(agentId, overrides?: Partial<AgentOptions>)` + `.getOrCreate(agentId, overrides?: Partial<AgentOptions>)`. Merge: top-level shallow merge, COM deep-merge explícito apenas para `local`, `memory`, `cloud` (mesmo padrão que `Agent.resume` já usa para `local`). `mcpServers`, `agents`, `tools`, `providers` são REPLACE total se overridden, igual à semântica de `SendOptions.mcpServers/tools`.
- **Rationale**: Reuso da regra já existente (`Agent.resume` deep-merges `local`). Replace-só para coleções porque merge profundo de arrays/maps gera bugs sutis (qual key vence? duplicates?). Consistência com `SendOptions`.
- **Consequências**: Consumer tem que re-supply o array completo de tools se quiser override por session. Comportamento previsível. Deep-merge isolado nos 3 campos já documentados.

### D24 — `defineTool` schema source: Zod-only vs Zod-or-JSON-Schema

- **Decisão**: `defineTool` aceita Zod schema (peer dep `^3.25 || ^4`, já declarado na toolchain). Internamente converte para JSON Schema via `z.toJSONSchema(schema)` (Zod 4) ou `zod-to-json-schema` (Zod 3) para popular `CustomTool.inputSchema`. Handler recebe input já parseado e tipado via `z.infer<typeof schema>`. Runtime: handler executa `schema.parse(input)` antes de invocar a função do usuário — input inválido gera `tool_result(isError)` com mensagem Zod.
- **Rationale**: Zod já é peer dep aceito. Type inference automática é o win real do helper (`CustomTool` puro força casts manuais). JSON Schema cru continua disponível via `AgentOptions.tools` direto — `defineTool` é opt-in.
- **Consequências**: Consumers que não usam Zod continuam com `CustomTool` literal — zero pressão. Consumers que adotam `defineTool` ganham type-safety + runtime validation grátis. Bundle size sobe ~10KB se o consumer ainda não importava Zod (peer dep, fica fora do nosso dist).

### D25 — `Agent.builder()` API shape: fluent vs staged

- **Decisão**: `Agent.builder()` retorna instância de `AgentBuilder` com chaining mutável (returna `this`). Setters: `.model(m)`, `.local(l)`, `.cloud(c)`, `.memory(m)`, `.systemPrompt(p)`, `.tools(t)`, `.mcpServers(s)`, `.agents(a)`, `.skills(s)`, `.plugins(p)`, `.providers(p)`, `.context(c)`, `.apiKey(k)`, `.agentId(id)`, `.name(n)`. Terminais: `.build(): AgentOptions`, `.create(): Promise<SDKAgent>`, `.getOrCreate(id): Promise<SDKAgent>`. Validação roda no terminal (`.build()`/`.create()`/`.getOrCreate()`), reusando `validateAgentOptions`.
- **Rationale**: Padrão JS/TS idiomático (Drizzle, Knex). Mutável evita alocação por chain (TS tipos preservados via `this`). Validação no terminal evita "half-built" leaking. Mesma surface que `Agent.create` — não inventa campos novos.
- **Consequências**: Builder é açúcar; usa `Agent.create`/`Agent.getOrCreate` internamente — zero duplicação de lógica. Builder não é serializável (não tem analogue de resume). Consumers podem usar `.build()` para inspecionar/logar AgentOptions antes do create.

### D26 — Cloud agent parity para os 4 helpers

- **Decisão**: Todos os 4 helpers funcionam idênticos para cloud agents (mesmas validações via `validateAgentOptions` no caminho terminal — `getOrCreate` chama `Agent.create` que valida; `factory.forSession` idem; `builder.create/getOrCreate` idem; `defineTool` produz `CustomTool` que `validateCustomTools` rejeita em cloud com `cloud_custom_tools_rejected`).
- **Rationale**: DRY — não duplicar regras de validação cloud. O contrato de "tools são local-only" continua o único point of cloud-rejection.
- **Consequências**: Mesma API surface para os dois runtimes. `defineTool` num cloud agent serializa cleanly até o ponto de `Agent.create` validar e jogar erro tipado.

## Dependency Graph

```
Phase 0 (ADRs) ──▶ Phase 1 (Agent.getOrCreate) ──▶ Phase 5 (Examples migration)
                                                        ▲
                   Phase 2 (createAgentFactory) ────────┤
                            │                            │
                            └─ depends on Phase 1        │
                                                         │
                   Phase 3 (defineTool) ─────────────────┤  (parallel to P2)
                                                         │
                   Phase 4 (Agent.builder) ──────────────┤  (parallel to P2/P3)
                            │                            │
                            └─ depends on Phase 1        │
                                                         │
                                              Phase 6 (Docs + CHANGELOG)
                                                         │
                                                         ▼
                                              Phase 7 (Dogfood QA)
```

**Sequenciamento:**
- Phase 0 (ADRs) bloqueia tudo — decisões precisam estar travadas antes do código.
- Phase 1 (`getOrCreate`) é foundational — Phase 2 e Phase 4 usam internamente.
- Phase 3 (`defineTool`) é independente de Phase 1 — pode rodar em paralelo com Phase 2/Phase 4.
- Phase 2, 3, 4 podem rodar em paralelo após Phase 1 estar verde.
- Phase 5 (migration de examples) depende dos 4 helpers prontos.
- Phase 6 (docs) consolida tudo.
- Phase 7 (dogfood) é o último gate.

---

## Phase 0: Lock ADRs (D22-D26)

**Objective:** Travar as 5 decisões arquiteturais antes de qualquer código — evita rework de naming/semantics no meio da implementação.

### T0.1 — Escrever ADRs D22-D26 como markdown commits

#### Objective
Cada ADR fica em `.claude/knowledge-base/adrs/D{N}-*.md` com formato Decision/Rationale/Consequences/Status. Garante audit-trail e referência cruzada nos tasks.

#### Evidence
Sessão atual produziu 5 decisões arquiteturais. Sem ADRs, futuras revisões redebatem (vide D17-D21 que economizaram retrabalho ao serem formalizados).

#### Files to edit
```
.claude/knowledge-base/adrs/D22-agent-getorcreate-semantics.md — (NEW)
.claude/knowledge-base/adrs/D23-agentfactory-merge-strategy.md — (NEW)
.claude/knowledge-base/adrs/D24-definetool-zod-source.md — (NEW)
.claude/knowledge-base/adrs/D25-agent-builder-api-shape.md — (NEW)
.claude/knowledge-base/adrs/D26-helpers-cloud-parity.md — (NEW)
packages/sdk/CLAUDE.md — atualizar tabela "Decided ADRs" com 5 novas entradas D22-D26
```

#### Deep file dependency analysis
- Os ADRs são standalone — nenhum código source depende deles diretamente. São referenciados via comentários nos arquivos source (`// See ADR D22`).
- `packages/sdk/CLAUDE.md` tabela ADR cresce de 14 → 19 linhas. Garante que próximas sessões enxerguem o estado decidido.

#### Deep Dives
Formato canônico de cada ADR:
```markdown
# D{N} — {Title}
**Status:** Decided  
**Date:** 2026-05-17

## Decision
{1-2 paragraphs}

## Rationale
{why this over alternatives}

## Consequences
{what this enables + what it constrains}
```

#### Tasks
1. Escrever D22-agent-getorcreate-semantics.md
2. Escrever D23-agentfactory-merge-strategy.md
3. Escrever D24-definetool-zod-source.md
4. Escrever D25-agent-builder-api-shape.md
5. Escrever D26-helpers-cloud-parity.md
6. Atualizar `packages/sdk/CLAUDE.md` tabela "Decided ADRs"

#### TDD
```
N/A — ADRs são documentação. Validação é via review.
```

#### Acceptance Criteria
- [ ] 5 arquivos .md criados em `.claude/knowledge-base/adrs/`
- [ ] CLAUDE.md tabela ADR atualizada
- [ ] Cada ADR tem Decision/Rationale/Consequences/Status
- [ ] Nenhum ADR menciona file paths (regra Quality #9)

#### DoD
- [ ] Os 5 arquivos commitados
- [ ] CLAUDE.md atualizado
- [ ] Próximas tasks podem citar D22-D26 por número

---

## Phase 1: `Agent.getOrCreate(id, options)`

**Objective:** Eliminar a boilerplate try/catch + UnknownAgentError + cold-create dos 6 examples.

### T1.1 — Implementar `Agent.getOrCreate` static method

#### Objective
Adicionar método estático que tenta resume primeiro, cai pra create no `UnknownAgentError`. Re-throw outras exceptions.

#### Evidence
- `examples/telegram-pro/src/agent.ts:99-153` tem 55 LoC só para essa lógica.
- `examples/telegram-bot/src/index.ts`, `examples/resume-agent/src/index.ts`, etc replicam.
- Sessão atual já validou o pattern manualmente — agora é só extrair.

#### Files to edit
```
packages/sdk/src/agent.ts — adicionar Agent.getOrCreate static method (~25 LoC)
packages/sdk/src/index.ts — re-export já é coberto pelo barrel "export { Agent }"
```

#### Deep file dependency analysis
- `agent.ts` atualmente tem 2 paths de entrada (`create`, `resume`). `getOrCreate` é a 3a — usa os 2 internamente. Não modifica nenhuma path existente.
- `Agent.create` lança `ConfigurationError` em vários códigos; `Agent.resume` lança `UnknownAgentError` no cold miss. `getOrCreate` faz catch APENAS de `UnknownAgentError`.

#### Deep Dives
Pseudocode (após edge-case-plan review — incorpora EC-1 race handling):
```ts
static async getOrCreate(agentId: string, options: AgentOptions): Promise<SDKAgent> {
  try {
    return await Agent.resume(agentId, options);
  } catch (err) {
    if (!(err instanceof UnknownAgentError)) throw err;
  }
  try {
    return await Agent.create({ ...options, agentId });
  } catch (err) {
    // EC-1: same-process race — outro caller venceu o create entre o nosso
    // resume miss e o nosso create. Reusa o handle que ele registrou.
    if (err instanceof ConfigurationError && err.code === "agent_already_exists") {
      return await Agent.resume(agentId, options);
    }
    throw err;
  }
}
```

Invariantes:
- `options` é o MESMO objeto passado em ambas as tentativas. Se o consumer tem `tools: [...]` em `options`, eles são re-supplied no resume (handlers válidos) E no create.
- O `agentId` é forçado no create (caso `options.agentId` esteja undefined ou diferente).
- Erro não-`UnknownAgentError` (no primeiro resume) ou não-`agent_already_exists` (no create) propaga sem ser silenciado.

Edge cases:
- **EC-1** (MUST FIX — addressed): Race em mesmo processo entre 2 calls `getOrCreate(sameId)`. Realista em bots Telegram com mensagens concorrentes do mesmo userId. Fix: catch `ConfigurationError(code:"agent_already_exists")` no create path e fazer 1 retry de resume.
- **EC-2** (cross-process): Race entre processos (per D22, documentado como limite de D17 "one SDK process per cwd").
- **EC-3**: `options.agentId` definido diferente do `agentId` param → o param vence (consistência via `{ ...options, agentId }` spread).
- **EC-4**: `Agent.resume` ok mas devolve agente CLOUD enquanto consumer passou `local: {...}` em options → resume já faz deep-merge correto (commit `3582788`).
- **EC-5** (documented): Options diferentes em chamadas consecutivas `getOrCreate(sameId, optsA)` então `getOrCreate(sameId, optsB)` → mesma semântica de `Agent.resume` (última call vence durante esse handle). JSDoc documenta.
- **EC-6** (documented): Agent disposto continua registrado; getOrCreate(disposedId) retorna handle inválido. Consumer deve usar `Agent.delete(id)` antes para hard reset. JSDoc documenta.

#### Tasks
1. RED: escrever `tests/golden/agent/getorcreate.golden.test.ts` com 5 testes
2. GREEN: adicionar method em `packages/sdk/src/agent.ts`
3. REFACTOR: nenhum esperado (método trivial)
4. VERIFY: `pnpm --filter=@usetheo/sdk run test -- getorcreate.golden`

#### TDD
```
RED:     getorcreate_creates_when_id_unknown() — assert: cold path → SDKAgent retornado com agentId esperado, options.tools propagadas
RED:     getorcreate_resumes_when_id_exists() — assert: pré-cria agente, depois getOrCreate retorna O MESMO agentId, registry size = 1
RED:     getorcreate_rethrows_non_unknown_errors() — assert: passar options inválidas (missing model) deve lançar ConfigurationError, não silenciar
RED:     getorcreate_forces_agentId_param_over_options_agentId() — assert: param "abc" vence sobre options.agentId="xyz"
RED:     getorcreate_resumes_with_supplied_tools() — assert: cria, dispose, getOrCreate com tools fresh → handlers ativos
RED:     getorcreate_handles_concurrent_create_race() — EC-1: Promise.all([getOrCreate(id,opts), getOrCreate(id,opts)]) → ambas retornam handles válidos, registry size = 1, segundo handle é o do winner
GREEN:   Implementar Agent.getOrCreate (~15 LoC inclusive race handling)
REFACTOR: None expected
VERIFY:  pnpm --filter=@usetheo/sdk run test -- getorcreate.golden
```

#### Acceptance Criteria
- [ ] 5 testes RED virando GREEN sem mudar outros testes
- [ ] `Agent.getOrCreate` exportado via `Agent` (export indireto via classe)
- [ ] Zero `as` casts no método
- [ ] Suite total: 303 → 308 (5 novos testes)
- [ ] Pass: pnpm check (Biome)
- [ ] Pass: pnpm typecheck (tsc --noEmit)
- [ ] Pass: pnpm run quality:loc (≤400 LoC por arquivo)

#### DoD
- [ ] T1.1 completo
- [ ] Suite verde
- [ ] CHANGELOG `[Unreleased]` Added entry pendente até Phase 6

---

## Phase 2: `createAgentFactory(common)`

**Objective:** Helper para chat-bot patterns onde o mesmo config é reutilizado por sessão/chat.

### T2.1 — Implementar `createAgentFactory`

#### Objective
Função `createAgentFactory(common: Partial<AgentOptions>)` retorna objeto `{ forSession, getOrCreate }` que merge per-session overrides com defaults capturados.

#### Evidence
- `examples/telegram-pro/src/agent.ts:99-153` mostra a mesma config (memory, providers, mcpServers, subagents, systemPrompt) duplicada entre resume e create paths.
- Função `getAgent(ctx, opts)` é chamada por turno — config é re-resolvida cada vez. Com factory, resolve 1 vez.

#### Files to edit
```
packages/sdk/src/agent-factory.ts — (NEW) função createAgentFactory
packages/sdk/src/index.ts — adicionar export
packages/sdk/src/types/agent.ts — adicionar type AgentFactory (public surface)
```

#### Deep file dependency analysis
- Novo arquivo `agent-factory.ts` é leaf — depende apenas de `Agent` (façade) e tipos. Não toca runtime interno.
- `index.ts` ganha 1 linha de export.
- `types/agent.ts` ganha o type `AgentFactory` (forSession + getOrCreate signatures).

#### Deep Dives
Public shape:
```ts
export interface AgentFactory {
  forSession(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
  getOrCreate(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
}

export function createAgentFactory(common: Partial<AgentOptions>): AgentFactory {
  return {
    forSession: (agentId, overrides) =>
      Agent.create(mergeOptions(common, overrides, agentId)),
    getOrCreate: (agentId, overrides) =>
      Agent.getOrCreate(agentId, mergeOptions(common, overrides, agentId)),
  };
}
```

Merge rules (per D23):
- Top-level: shallow merge — `overrides` vence
- `local`: deep merge `{ ...common.local, ...overrides.local }`
- `memory`: deep merge mesmo pattern
- `cloud`: deep merge mesmo pattern
- `mcpServers`, `agents`, `tools`, `providers`, `plugins`, `skills`, `context`: REPLACE total

Invariantes:
- `agentId` SEMPRE vem do parâmetro (sobrescreve `common.agentId` e `overrides.agentId`).
- Se nem `common` nem `overrides` têm `model` → `Agent.create` lança `missing_model` ConfigurationError. Factory não valida sozinha (delega).

Edge cases:
- **EC-1**: `common.tools=[a,b]` + `overrides.tools=[c]` → resultante = `[c]` (replace).
- **EC-2**: `common.memory={ enabled: true, namespace: "x" }` + `overrides.memory={ userId: "u1" }` → resultante = `{ enabled: true, namespace: "x", userId: "u1" }` (deep merge).
- **EC-3**: Race quando 2 sends simultâneos chamam `forSession(sameId)` → cada um cria/resume separadamente; já há mutex per-agentId no runtime (D19), então não há corrupção.

#### Tasks
1. RED: escrever `tests/golden/agent/factory.golden.test.ts` com 6 testes
2. GREEN: criar `agent-factory.ts` + export
3. REFACTOR: extrair `mergeOptions` se inline ficar pesado
4. VERIFY: `pnpm --filter=@usetheo/sdk run test -- factory.golden`

#### TDD
```
RED:     factory_forSession_merges_common_and_overrides() — assert: model em common, systemPrompt em overrides → ambos no agent
RED:     factory_forSession_local_deep_merge() — assert: local.cwd em common, local.sandboxOptions em overrides → ambos preservados
RED:     factory_forSession_tools_replace() — assert: tools em common, tools em overrides → result = overrides.tools só
RED:     factory_getOrCreate_resumes_existing() — assert: cria via forSession, depois getOrCreate mesmo id → retorna handle ativo
RED:     factory_param_agentId_wins_over_common_and_overrides() — assert: common.agentId="a", overrides.agentId="b", forSession("c") → agente tem id "c"
RED:     factory_propagates_validation_errors() — assert: common SEM model + overrides SEM model → forSession lança missing_model
GREEN:   Implementar createAgentFactory + mergeOptions (~30 LoC)
REFACTOR: extrair mergeOptions se complexity > 10 (Biome G9)
VERIFY:  pnpm --filter=@usetheo/sdk run test -- factory.golden
```

#### Acceptance Criteria
- [ ] 6 testes verdes
- [ ] `createAgentFactory` exportado via barrel
- [ ] `AgentFactory` type público
- [ ] Pass: pnpm check
- [ ] Pass: pnpm typecheck
- [ ] Pass: G9 (jscpd) — zero clones com Phase 1

#### DoD
- [ ] T2.1 completo
- [ ] Suite 308 → 314

---

## Phase 3: `defineTool(spec)` (parallel to Phase 2/4)

**Objective:** Type-safe tool definition via Zod schema → inferência automática + runtime validation.

### T3.1 — Implementar `defineTool` com Zod

#### Objective
Função `defineTool<T extends ZodSchema>(spec)` retorna `CustomTool` com handler que recebe `z.infer<T>` (tipado) e que valida input em runtime via `schema.parse`.

#### Evidence
- `examples/telegram-pro/src/ad-hoc-tools.ts` tem 4 type-casts `as RollInput`, `as Base64Input`, `as HashInput`, `as TimezoneInput`. Nenhum runtime check — input malformed silenciosamente vira NaN/undefined.
- Zod já é peer dep no CLAUDE.md (toolchain table).

#### Files to edit
```
packages/sdk/src/define-tool.ts — (NEW) defineTool function
packages/sdk/src/index.ts — adicionar export
packages/sdk/src/types/agent.ts — type DefinedTool<T> (público)
packages/sdk/package.json — peer dep Zod já declarada; nenhuma mudança
```

#### Deep file dependency analysis
- Novo `define-tool.ts` é leaf, depende de:
  - `zod` (peer dep)
  - `CustomTool` (tipo existente)
- `index.ts` ganha 1 linha de export.
- `types/agent.ts` ganha o type genérico `DefinedTool<T>` (mais ergonômico que retornar `CustomTool` cru).

#### Deep Dives
Public shape:
```ts
import type { ZodType, z } from "zod";

export interface DefineToolSpec<T extends ZodType> {
  name: string;
  description: string;
  inputSchema: T;
  handler: (input: z.infer<T>) => string | Promise<string>;
}

export function defineTool<T extends ZodType>(spec: DefineToolSpec<T>): CustomTool {
  const jsonSchema = zodToJsonSchema(spec.inputSchema);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: jsonSchema,
    handler: async (input) => {
      const parsed = spec.inputSchema.parse(input);
      return await spec.handler(parsed);
    },
  };
}
```

Zod-to-JSON-Schema: para Zod 4 usar `z.toJSONSchema()` (native); para Zod 3 usar `zod-to-json-schema` package (light dep, ~5KB). Detecção via feature-check (`typeof z.toJSONSchema === "function"`).

Invariantes:
- `spec.handler` recebe TIPO INFERIDO, não `Record<string, unknown>`.
- Runtime parse falha → throw ZodError com message clara → tool-dispatch já converte para `tool_result(isError)` (commit `3582788`).
- `inputSchema` resultante é JSON Schema válido (testado por golden).

Edge cases:
- **EC-1**: Schema sem `type: "object"` (e.g., `z.string()` direto) → `validateCustomTools` rejeita com `tool_invalid_schema_type`. defineTool propaga sem swallowing.
- **EC-2**: Handler throw → tool-dispatch trata como exit 1 (já testado em commit `3582788`).
- **EC-3**: Zod schema com `transform()` → `z.infer` reflete o tipo OUTPUT do transform. Documentado.

#### Tasks
1. Decidir Zod 3 vs 4 vs both — preferir both via feature-check
2. Adicionar `zod-to-json-schema` como dep (Zod 3 path) ou usar `z.toJSONSchema` (Zod 4)
3. RED: escrever `tests/golden/agent/define-tool.golden.test.ts` com 5 testes
4. GREEN: implementar
5. VERIFY: `pnpm --filter=@usetheo/sdk run test -- define-tool.golden`

#### TDD
```
RED:     definetool_returns_valid_CustomTool() — assert: defineTool({name,description,inputSchema:z.object({x:z.number()}),handler}) → tool com inputSchema {type:"object",properties:{x:{type:"number"}}}
RED:     definetool_parses_input_at_runtime() — assert: invocar handler com {x:"not-a-number"} → ZodError → tool_result(isError)
RED:     definetool_handler_receives_typed_input() — TS-level: handler arg type = {x: number} (não Record<string,unknown>)
RED:     definetool_propagates_handler_throw() — assert: handler throws Error → tool_result(isError) com message
RED:     definetool_rejected_by_validateCustomTools_when_schema_is_not_object() — assert: defineTool com z.string() schema → Agent.create lança tool_invalid_schema_type
RED:     definetool_handler_receives_zod_transform_output() — EC-3: schema com z.string().transform(Number); LLM emite "8080" → handler recebe 8080 (number), não "8080" (string)
GREEN:   Implementar defineTool com z.toJSONSchema + parse
REFACTOR: extrair zodToJsonSchema se necessário
VERIFY:  pnpm --filter=@usetheo/sdk run test -- define-tool.golden
```

#### Acceptance Criteria
- [ ] 5 testes verdes
- [ ] Zod-to-JSON-Schema funciona com Zod 3 E Zod 4 (feature-detect)
- [ ] TS infere `z.infer<T>` corretamente no handler
- [ ] `defineTool` exportado via barrel
- [ ] Pass: pnpm check
- [ ] Pass: pnpm typecheck
- [ ] Pass: G7 (knip — nada órfão)

#### DoD
- [ ] T3.1 completo
- [ ] Suite 314 → 319

---

## Phase 4: `Agent.builder()` (parallel to Phase 2/3)

**Objective:** Fluent builder pattern para construção progressiva de agents.

### T4.1 — Implementar `AgentBuilder` class

#### Objective
Classe com chainable setters + terminais `.build()` (retorna AgentOptions), `.create()` (Agent.create), `.getOrCreate(id)` (Agent.getOrCreate).

#### Evidence
- Algumas equipes preferem fluent chains a options bag (Drizzle, Knex, AWS SDK v3 builders pontuais).
- Útil quando config é progressiva (e.g., resolvendo providers async antes de finalizar).
- Sessão atual decidiu (D25) que é açúcar sintático sobre `Agent.create` / `Agent.getOrCreate` — zero lógica duplicada.

#### Files to edit
```
packages/sdk/src/agent-builder.ts — (NEW) AgentBuilder class
packages/sdk/src/agent.ts — adicionar Agent.builder() static factory
packages/sdk/src/index.ts — adicionar export AgentBuilder
packages/sdk/src/types/agent.ts — export type AgentBuilder se útil para consumers
```

#### Deep file dependency analysis
- Novo `agent-builder.ts` é leaf — depende apenas de `AgentOptions`, `Agent`, `SDKAgent`. Não toca runtime interno.
- `agent.ts` ganha 1 método estático `Agent.builder(): AgentBuilder`.
- Builder NÃO duplica validação — chama `Agent.create`/`Agent.getOrCreate` que rodam `validateAgentOptions` já existente.

#### Deep Dives
Public shape (todos os métodos returnam `this`):
```ts
export class AgentBuilder {
  private opts: Partial<AgentOptions> = {};

  model(m: ModelSelection): this { this.opts.model = m; return this; }
  apiKey(k: string): this { this.opts.apiKey = k; return this; }
  systemPrompt(p: string | SystemPromptResolver): this { this.opts.systemPrompt = p; return this; }
  local(l: LocalOptions): this { this.opts.local = l; return this; }
  cloud(c: CloudOptions): this { this.opts.cloud = c; return this; }
  memory(m: MemorySettings): this { this.opts.memory = m; return this; }
  tools(t: CustomTool[]): this { this.opts.tools = t; return this; }
  mcpServers(s: Record<string, McpServerConfig>): this { this.opts.mcpServers = s; return this; }
  agents(a: Record<string, AgentDefinition>): this { this.opts.agents = a; return this; }
  context(c: ContextSettings): this { this.opts.context = c; return this; }
  providers(p: ProviderRoutingSettings): this { this.opts.providers = p; return this; }
  plugins(p: PluginsSettings): this { this.opts.plugins = p; return this; }
  skills(s: SkillsSettings): this { this.opts.skills = s; return this; }
  agentId(id: string): this { this.opts.agentId = id; return this; }
  name(n: string): this { this.opts.name = n; return this; }

  build(): AgentOptions { return { ...this.opts } as AgentOptions; } // EC-2: shallow clone
  create(): Promise<SDKAgent> { return Agent.create(this.build()); }
  getOrCreate(agentId: string): Promise<SDKAgent> { return Agent.getOrCreate(agentId, this.build()); }
}
```

Invariantes:
- Cada setter SOBRESCREVE (não merge). Para merge use factory ou monta options manualmente.
- `.build()` retorna SHALLOW CLONE do `this.opts` — mutar o resultado NÃO afeta `.create()` subsequente (EC-2).
- `.create()` / `.getOrCreate()` validam via `Agent.create`/`Agent.getOrCreate`.

Edge cases:
- **EC-1**: Builder sem `.model()` → `.create()` lança `missing_model`. Builder não pre-valida; consistência com options bag.
- **EC-2**: Setter chamado 2x → último vence (sem warn). Documentado.
- **EC-3**: `.tools([a]).tools([b])` → tools = [b]. Replace semantics.

#### Tasks
1. RED: escrever `tests/golden/agent/builder.golden.test.ts` com 6 testes
2. GREEN: criar `agent-builder.ts` + `Agent.builder()` static + exports
3. REFACTOR: nenhum esperado (boilerplate trivial)
4. VERIFY: `pnpm --filter=@usetheo/sdk run test -- builder.golden`

#### TDD
```
RED:     builder_build_returns_AgentOptions() — assert: builder().model({id:"x"}).local({cwd:"/tmp"}).build() → AgentOptions com ambos campos
RED:     builder_create_calls_Agent_create() — assert: .create() retorna SDKAgent registrado, mesma identidade que Agent.create direto
RED:     builder_getOrCreate_calls_Agent_getOrCreate() — assert: cria, dispose, builder().getOrCreate(id) retorna handle ativo
RED:     builder_setter_replaces_not_merges() — assert: .tools([a]).tools([b]).build().tools = [b]
RED:     builder_propagates_validation_errors() — assert: builder().local({...}).create() (sem model) → missing_model
RED:     builder_chainable_returns_this() — TS-level: cada setter retorna AgentBuilder (this), permite chain infinita
RED:     builder_build_returns_independent_snapshot() — EC-2: builder.build() !== builder.build(); mutar o primeiro NÃO afeta .create() (shallow clone)
GREEN:   Implementar AgentBuilder class + Agent.builder() static
REFACTOR: None expected
VERIFY:  pnpm --filter=@usetheo/sdk run test -- builder.golden
```

#### Acceptance Criteria
- [ ] 6 testes verdes
- [ ] `Agent.builder()` exportado via `Agent`
- [ ] `AgentBuilder` exportado via barrel
- [ ] Cada setter aceita exatamente o type correspondente em `AgentOptions`
- [ ] Pass: pnpm check
- [ ] Pass: pnpm typecheck
- [ ] Pass: G8 (≤400 LoC — builder file deve ficar < 100 LoC)

#### DoD
- [ ] T4.1 completo
- [ ] Suite 319 → 325

---

## Phase 5: Migrar 6 examples para usar helpers

**Objective:** Dogfooding interno — provar que os helpers reduzem código real.

### T5.1 — Refatorar `examples/telegram-pro/src/agent.ts` (caso piloto)

#### Objective
Substituir o try/catch + cold-create boilerplate por `Agent.getOrCreate` + `createAgentFactory`. Resultado: arquivo encolhe de 155 LoC para ~75 LoC.

#### Evidence
- Tamanho atual: ~155 LoC.
- Boilerplate identificável: linhas 99-153 (resume-or-create dance).

#### Files to edit
```
examples/telegram-pro/src/agent.ts — refactor para usar createAgentFactory + getOrCreate
examples/telegram-pro/src/ad-hoc-tools.ts — refactor para usar defineTool
examples/telegram-pro/package.json — adicionar Zod ^4 como dep se ainda não estiver
```

#### Deep file dependency analysis
- `agent.ts` exporta `getAgent`, `SYSTEM_PROMPT`, `resolveAgentId`, `resolveUserId`, `TELEGRAM_PRO_CUSTOM_TOOLS`. `getAgent` ganha implementação via factory; outras exports inalteradas.
- `ad-hoc-tools.ts` exporta `AD_HOC_TOOLS`, `listAdHocTools`. Após defineTool, cada tool é definido com `defineTool({...})` em vez de `{ name, description, inputSchema, handler }` literal.
- `package.json` ganha `zod` dep (peer no SDK, mas examples instalam direto).
- Outros arquivos (`index.ts`, `loops.ts`, `commands.ts`) usam `getAgent` — interface mantida, zero mudança nesses.

#### Deep Dives
Refactor agent.ts:
```ts
const factory = createAgentFactory({
  apiKey: opts.apiKey,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: opts.cwd, settingSources: ["project", "plugins"], sandboxOptions: { enabled: true } },
  agents: TELEGRAM_PRO_SUBAGENTS,
  context: { manager: "file" },
  tools: TELEGRAM_PRO_CUSTOM_TOOLS,
  systemPrompt: SYSTEM_PROMPT,
  ...(buildProviderRouting() !== undefined ? { providers: buildProviderRouting() } : {}),
  ...(buildMcpServers(opts.cwd) !== undefined ? { mcpServers: buildMcpServers(opts.cwd) } : {}),
});

export async function getAgent(ctx, opts) {
  const agentId = resolveAgentId(ctx);
  const userId = resolveUserId(ctx);
  return factory.getOrCreate(agentId, {
    memory: { enabled: true, namespace: "tg-pro", scope: "user", userId, activeRecall: { enabled: true, queryMode: "recent" } },
  });
}
```

Net: 55 → ~10 LoC. -45 LoC.

Refactor ad-hoc-tools.ts:
```ts
import { z } from "zod";
import { defineTool } from "@usetheo/sdk";

const rollSchema = z.object({
  count: z.number().int().min(1).max(100),
  sides: z.number().int().min(2).max(1000),
});

export const AD_HOC_TOOLS: Record<string, CustomTool> = {
  uuid: defineTool({ name: "uuid", description: "...", inputSchema: z.object({}), handler: () => JSON.stringify({uuid: randomUUID()}) }),
  roll: defineTool({ name: "roll", description: "...", inputSchema: rollSchema, handler: ({count, sides}) => {...} }),
  // ...
};
```

Net: remove `as RollInput` casts; ganha type-safety + runtime validation.

#### Tasks
1. Atualizar `examples/telegram-pro/package.json` com `zod` dep
2. Refatorar `agent.ts` para usar factory + getOrCreate
3. Refatorar `ad-hoc-tools.ts` para usar defineTool
4. `pnpm install --ignore-workspace` no telegram-pro
5. `pnpm typecheck` + `pnpm dev` (smoke boot)

#### TDD
```
RED:     telegram_pro_typecheck_clean() — pnpm tsc --noEmit retorna 0 (gate: zero errors)
RED:     telegram_pro_agent_ts_under_100_loc() — wc -l < 100
RED:     telegram_pro_ad_hoc_tools_zero_casts() — grep -c "as " src/ad-hoc-tools.ts == 0
RED:     telegram_pro_roll_invalid_input_returns_isError() — EC-4: simular LLM enviando count:"three" para roll; assert tool_result.isError=true com ZodError message (mudança deliberada vs silent clampInt fallback)
GREEN:   Refactor + install
REFACTOR: Inline buildProviderRouting() / buildMcpServers() se ficar verboso
VERIFY:  cd examples/telegram-pro && pnpm typecheck && pnpm dev (até "Connected as ...")
```

#### Acceptance Criteria
- [ ] telegram-pro typecheck clean
- [ ] agent.ts < 100 LoC
- [ ] ad-hoc-tools.ts sem `as` casts
- [ ] pnpm dev boot ok (Connected as @theo_paulo_bot)
- [ ] /tool uuid responde com UUID v4 real
- [ ] current_time responde com 2026-* timestamp

#### DoD
- [ ] T5.1 completo
- [ ] Smoke boot ok

### T5.2 — Refatorar `examples/telegram-bot/src/index.ts`

#### Objective
Mesma migração que T5.1 mas no example mais minimal.

#### Evidence
`examples/telegram-bot/` é a versão simplificada predecessora de telegram-pro. Boilerplate similar mas menor.

#### Files to edit
```
examples/telegram-bot/src/index.ts — usar Agent.getOrCreate em vez de try/catch
examples/telegram-bot/package.json — sem mudança (não usa custom tools)
```

#### Deep file dependency analysis
Standalone — só usa Agent.create/resume e nada mais sofisticado.

#### Deep Dives
Substituir `Agent.resume` + cold create por `Agent.getOrCreate` direto. ~20 LoC removidas.

#### Tasks
1. Identificar bloco try/catch
2. Substituir por `Agent.getOrCreate(agentId, options)`
3. Smoke boot

#### TDD
```
RED:     telegram_bot_typecheck() — npx tsc --noEmit
GREEN:   Refactor
VERIFY:  cd examples/telegram-bot && pnpm dev
```

#### Acceptance Criteria
- [ ] Typecheck clean
- [ ] Bot boot ok

#### DoD
- [ ] T5.2 completo

### T5.3 — Refatorar `examples/resume-agent/src/index.ts`

#### Objective
Substituir Agent.resume manual por Agent.getOrCreate.

#### Files to edit
```
examples/resume-agent/src/index.ts
```

#### Deep file dependency analysis
Example didático — propósito é demonstrar resume. Adicionar comentário explicando: "this example shows both Agent.resume (low-level) AND Agent.getOrCreate (high-level convenience)".

#### Tasks
1. Adicionar bloco demonstrando Agent.getOrCreate ao lado de Agent.resume
2. README narra a diferença

#### TDD
```
RED:     resume_agent_typecheck()
GREEN:   Add helper demo block
VERIFY:  pnpm dev
```

#### Acceptance Criteria
- [ ] Both Agent.resume e Agent.getOrCreate demonstrados
- [ ] Typecheck clean

#### DoD
- [ ] T5.3 completo

### T5.4 — Refatorar `examples/agent-management/src/index.ts`

#### Objective
Demonstrar Agent.getOrCreate + Agent.builder() lado a lado.

#### Files to edit
```
examples/agent-management/src/index.ts
```

#### Deep file dependency analysis
Example já mostra Agent.list/get/delete. Adicionar Agent.builder() create + Agent.getOrCreate resume.

#### Tasks
1. Adicionar 2 blocos: builder, getOrCreate
2. Atualizar README

#### TDD
```
RED:     agent_management_typecheck()
GREEN:   Add demo blocks
VERIFY:  pnpm dev
```

#### Acceptance Criteria
- [ ] Demos rodam
- [ ] Typecheck clean

#### DoD
- [ ] T5.4 completo

### T5.5 — Refatorar `examples/error-handling/src/index.ts`

#### Objective
Mostrar Agent.getOrCreate propagando ConfigurationError (não silenciando).

#### Files to edit
```
examples/error-handling/src/index.ts
```

#### Tasks
1. Adicionar caso "getOrCreate com options inválidas → ConfigurationError propagado"

#### TDD
```
RED:     error_handling_typecheck()
GREEN:   Add ConfigurationError demo
VERIFY:  pnpm dev
```

#### Acceptance Criteria
- [ ] ConfigurationError propagado, não swallow

#### DoD
- [ ] T5.5 completo

### T5.6 — Refatorar `examples/error-handling-full/src/index.ts`

#### Objective
Similar a T5.5, cobertura ampla.

#### Files to edit
```
examples/error-handling-full/src/index.ts
```

#### Tasks
1. Cobrir cada caso de erro com Agent.getOrCreate

#### TDD
```
RED:     error_handling_full_typecheck()
GREEN:   Migration
VERIFY:  pnpm dev
```

#### Acceptance Criteria
- [ ] Todos os casos de erro cobertos

#### DoD
- [ ] T5.6 completo

---

## Phase 6: Docs + CHANGELOG

**Objective:** Documentar os 4 helpers no docs.md + entrada CHANGELOG.

### T6.1 — Atualizar docs.md com 4 helpers

#### Objective
Adicionar seções `Agent.getOrCreate`, `createAgentFactory`, `defineTool`, `Agent.builder()` ao `docs.md`.

#### Evidence
docs.md é a source of truth (per packages/sdk/CLAUDE.md). Sem entry, helper não existe na contract.

#### Files to edit
```
packages/sdk/docs.md — adicionar 4 seções (signature, options, exemplo)
packages/sdk/CHANGELOG.md — adicionar 4 entries [Unreleased] Added
```

#### Deep file dependency analysis
docs.md é referência única; agentes futuros consultam para entender API. CHANGELOG segue Keep-a-Changelog (CLAUDE.md global rule 6).

#### Tasks
1. Adicionar `### Agent.getOrCreate` em docs.md
2. Adicionar `### createAgentFactory` em docs.md
3. Adicionar `### defineTool` em docs.md
4. Adicionar `### Agent.builder()` em docs.md
5. CHANGELOG: 4 entries Added

#### TDD
```
N/A — docs.
```

#### Acceptance Criteria
- [ ] 4 seções em docs.md
- [ ] 4 entries em CHANGELOG
- [ ] Cada doc tem signature + 1 exemplo + 1 frase de quando usar

#### DoD
- [ ] T6.1 completo

---

## Phase 7: Dogfood QA (MANDATORY)

**Objective:** Validar com LLM real no telegram-pro que os 4 helpers funcionam end-to-end após o refactor.

### Execution

1. Restart bot (`pnpm dev` via dev.sh wrapper)
2. Rodar CDP test suite:
   - `/tool list` → registry visível
   - `/tool uuid` → UUID v4 real
   - `/tool roll 3d6` → dice rolls reais
   - `/tool hash sha256 hello` → `2cf24dba…938b9824`
   - `current_time` via natural language → 2026-* timestamp
   - `Remember: meu time é Corinthians` → MEMORY.md update
   - `/recall corinthians` → sessions corpus search
   - `/loop 30s diga oi` → cron-fired loop
3. Verificar logs: `[bot] result status=finished` em todos os runs

### Acceptance Criteria

- [ ] /tool family: 4/4 passa (uuid + roll + hash + base64)
- [ ] current_time agent-level: passa
- [ ] Memory write + recall: passa
- [ ] /loop schedule + stop: passa
- [ ] Zero `cloud_custom_tools_rejected` errors (cloud agent não usado aqui mas regression check)
- [ ] CDP run capture > 4/5 tests pass (≥80% via DOM, complementado por messages.jsonl)
- [ ] Zero CRITICAL regressions vs estado anterior

### If Dogfood Fails

1. Identificar qual helper introduziu o issue
2. Reverter o use no example (não no helper) se issue é só de migration
3. Re-rodar dogfood
4. Pre-existing issues documentados

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | (a) Agent.getOrCreate | T1.1 | Static method que tenta resume → cai pra create |
| 2 | (b) createAgentFactory | T2.1 | Factory closure com `forSession` + `getOrCreate` |
| 3 | (c) defineTool | T3.1 | Zod-driven builder com runtime parse |
| 4 | (d) Agent.builder() fluent | T4.1 | Class chainable com terminais `build/create/getOrCreate` |
| 5 | Eliminar boilerplate em telegram-pro | T5.1 | Refactor agent.ts + ad-hoc-tools.ts |
| 6 | Eliminar boilerplate em outros 5 examples | T5.2-T5.6 | Migration progressiva |
| 7 | ADRs (naming, cloud, persistence) | T0.1 | D22-D26 escritos |
| 8 | TDD por helper | T1.1, T2.1, T3.1, T4.1 | 5-6 testes RED por helper |
| 9 | Cloud parity | D26 + reuso de validateAgentOptions | Sem código novo de validação; helpers usam create/getOrCreate |
| 10 | Persistência (handlers não-serializáveis) | T2.1 + EC docs | Factory carrega handlers em-memória; resume re-supply |
| 11 | Dogfood real-LLM | Phase 7 | CDP test suite contra bot real |
| 12 | Docs + CHANGELOG | T6.1 | docs.md + CHANGELOG entries |

**Coverage: 12/12 gaps covered (100%)**

## Global Definition of Done

- [x] All phases completed (Phase 0-7)
- [x] Suite passing: 303 → **331** (8 getOrCreate + 7 factory + 6 defineTool + 7 builder + existentes)
- [x] Zero Biome lint warnings
- [x] Zero `tsc --noEmit` errors
- [x] Pass `pnpm -w run validate` (full hard gates G1-G9) — exit=0
- [x] Backward compatibility preserved (`Agent.create`/`Agent.resume` inalterados)
- [x] 5 ADRs lockados (D22-D26)
- [x] 6 examples migrados, todos com `pnpm typecheck` clean (telegram-pro, telegram-bot, resume-agent, agent-management, error-handling, error-handling-full)
- [x] docs.md atualizado (4 novas seções)
- [x] CHANGELOG `[Unreleased]` com 4 entries (getOrCreate, factory, defineTool, builder)
- [x] **Dogfood QA PASS** — telegram-pro com factory + getOrCreate + defineTool boot ok; `/tool uuid` (UUID v4), `/tool hash sha256 hello` (`2cf24dba…938b9824`), `current_time` (2026-05-17T15:15:29.045Z) persistidos em messages.jsonl
- [x] **Runtime-metric proof** — UUID com bit 13=`4c` (v4 válido), SHA256 match exato `echo -n hello | sha256sum`, timestamp = ano corrente (não training-data hallucination).

## Final Phase: Dogfood QA (MANDATORY)

Já coberto em Phase 7 acima.

---

## Riscos e Mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Zod 3 vs Zod 4 API divergence (z.toJSONSchema é novo em 4) | Média | Feature-detect em `defineTool` + fallback para `zod-to-json-schema` dep |
| Builder mutável surpreende usuários acostumados com imutável | Baixa | Documentar; cada setter retorna `this` (não new instance) — claro no JSDoc |
| Factory captura by-reference: mutar `common` depois de criar afeta sessions futuras | Baixa | Documentar; consumidor cuidadoso clona se necessário. Não fazer deep-clone interno (overhead) |
| Refactor de 6 examples introduz bugs sutis | Média | Smoke boot em cada example pós-migration; CDP test no telegram-pro |
| `Agent.getOrCreate` aceita options inválidas no path resume mas válidas no create | Baixa | Resume já valida (D17); create valida via validateAgentOptions. Consistente. |
| Bundle size cresce 10KB com Zod opt-in (peer dep) | Baixa | Zod já é peer dep declarado. Consumers que não usam defineTool não importam |
