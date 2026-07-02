---
name: to-reference
description: "Deep dive nas implementações de referência em `.claude/knowledge-base/reference/` para extrair técnicas, padrões, dependências externas, design patterns, algoritmos, edge cases — TUDO necessário para escrever o módulo equivalente no SDK. Gera um guia de implementação completo em `.claude/knowledge-base/reference/{topic}.md`. Use ANTES de começar a codar qualquer módulo não-trivial."
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash, Write, Agent
argument-hint: "<topic> [--impl openai-agents-python,pi,opencode,...] [--depth exhaustive|standard]"
---

# to-reference: Deep Dive → Guia de Implementação

**Não é benchmark, não é marketing, não é "disruptive bet".** Esta skill produz um documento que um humano (ou outro Claude) lê e consegue **implementar o módulo no `@theokit/sdk` sem precisar voltar a pesquisar nada**.

Exemplo concreto do output esperado:

> Input: `/to-reference context compaction`
> Output: `.claude/knowledge-base/reference/context-compaction.md` — 8–15 páginas com como `openai-agents-python` faz compaction/summarization do histórico (file:line), como `opencode` encara o problema, que libs internas usam (e.g. tokenizers), que gatilho de threshold usam, edge cases conhecidos (e.g. summarizar no meio de um tool-call em aberto), e **plano de implementação para o `@theokit/sdk`** (arquivos a criar em `packages/sdk/src/`, API pública, deps a adotar, fases de rollout, testes).

Quem ler esse documento depois deve conseguir abrir um editor e começar a digitar código.

---

## Argumentos

- `$ARGUMENTS` primeira parte = tópico em natural language (ex: `context compaction`, `tool-call dispatch`, `subagent handoffs`, `streaming SSE`)
- `--impl <names>` = subset de implementações em `.claude/knowledge-base/reference/` (default: todas que tiverem o keyword)
- `--depth exhaustive|standard` (**default `exhaustive`** — o output desta skill é o blueprint da implementação; vale a hora extra)
  - `exhaustive` ≈ 2h — TODOS os frameworks com keyword, deep read do inventário completo, git arqueologia, RFCs públicas, edge case enumeration. **Padrão.**
  - `standard` ≈ 45–60 min — escape hatch quando o tópico já tem `.claude/knowledge-base/reference/{slug}.md` recente e você só precisa de refresh pontual. 3+ frameworks, padrões extraídos, deps catalogadas, implementation guide. Quality bar é o mesmo — só o número mínimo de frameworks cai de "todos com keyword" para 3.

---

## Output canônico

**Local fixo:** `.claude/knowledge-base/reference/{topic-kebab}.md`

`{topic-kebab}` é a versão kebab-case do tópico (ex: `context compaction` → `context-compaction.md`). Sem subpastas, sem prefixos de data. Um arquivo por tópico. Reexecutar a skill no mesmo tópico **sobrescreve com aviso** — força commit antes de sobrescrever.

Antes de qualquer Write:

```bash
mkdir -p .claude/knowledge-base/reference
test -f .claude/knowledge-base/reference/{slug}.md && \
  echo "WARN: documento existente. Commit suas mudanças antes." || \
  echo "OK: novo documento."
```

---

## Discovery dinâmica

**NUNCA hardcode a lista de frameworks.** Os clones-peer vivem em `.claude/knowledge-base/reference/` (alguns rastreados no repo, outros gitignored per-dev — o conjunto varia por checkout). Os `.md` no mesmo diretório são guias destilados, não clones; o glob `*/` abaixo lista só os diretórios (clones). Sempre comece com:

```bash
ls -d .claude/knowledge-base/reference/*/ 2>/dev/null | sed 's|.claude/knowledge-base/reference/||;s|/$||'
```

Se não houver nenhum clone (só `.md`), **pare e instrua o usuário a clonar** (ver seção de clonagem no final). Não invente prior art.

Para cada framework presente, descubra a linguagem e o tamanho:

```bash
for ref in .claude/knowledge-base/reference/*/; do
  name=$(basename "$ref")
  ts=$(find "$ref" -name "*.ts" ! -path "*/node_modules/*" 2>/dev/null | wc -l)
  py=$(find "$ref" -name "*.py" ! -path "*/node_modules/*" 2>/dev/null | wc -l)
  rs=$(find "$ref" -name "*.rs" ! -path "*/node_modules/*" 2>/dev/null | wc -l)
  go=$(find "$ref" -name "*.go" ! -path "*/node_modules/*" 2>/dev/null | wc -l)
  echo "$name | ts:$ts py:$py rs:$rs go:$go"
done
```

---

## Processo

### Passo 1 — Mapear o problema

Antes de tocar `.claude/knowledge-base/reference/`:

1. **Qual o problema concreto** o SDK quer resolver com este módulo?
2. **Qual a área do SDK afetada?** (`packages/sdk/src/{agent,cron,memory,...}` ou `packages/sdk/src/internal/{agent-loop,llm,tool-dispatch,mcp,memory,runtime,providers,...}`; ou outro package do workspace — `packages/{cli,acp,sdk-tools,...}`)
3. **Já existe algo parcial?** `grep -rln "{keyword}" packages/`
4. **Quais arquivos da pasta `.claude/knowledge-base/reference/` referenciam tópicos vizinhos?** (evita escrever doc isolado quando há contexto)

Salve esses 4 itens em um buffer mental — viram a primeira seção do doc.

### Passo 2 — Inventário COMPLETO de arquivos relevantes (mandatório)

**Regra inviolável:** o output cita TODOS os arquivos que tocam o tópico — não uma amostra, não os "principais". Se um arquivo aparece num grep do keyword e não é descartado por motivo explícito (test fixture trivial, generated code), ele entra no inventário.

Para cada framework em `.claude/knowledge-base/reference/`, gere o inventário com 3 passadas complementares:

```bash
KEYWORD="<termo principal>"   # ex: tool, handoff, compaction, stream
ALT_KEYWORDS="<sinônimos>"    # ex: "tool_call|function_call|dispatch|tool_choice"

for fw in $(ls -d .claude/knowledge-base/reference/*/); do
  name=$(basename "$fw")
  echo "=== $name ==="

  # Passada 1 — Nome do arquivo contém o keyword
  find "$fw" -type f \
    \( -name "*${KEYWORD}*" -o -iregex ".*\(${ALT_KEYWORDS}\).*" \) \
    ! -path "*/node_modules/*" ! -path "*/dist/*" ! -path "*/build/*" \
    ! -path "*/.git/*" 2>/dev/null

  # Passada 2 — Conteúdo do arquivo menciona o keyword (qualquer linguagem)
  grep -rln -E "\b(${KEYWORD}|${ALT_KEYWORDS})\b" "$fw" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
    --include="*.rs" --include="*.rb" --include="*.go" --include="*.py" \
    --include="*.md" --include="*.json" --include="*.toml" --include="*.yml" \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
    --exclude-dir=.git 2>/dev/null

  # Passada 3 — Documentação, RFCs, design docs no tree
  find "$fw" -type f \
    \( -iname "RFC*" -o -iname "DESIGN*" -o -iname "ARCHITECTURE*" \
       -o -iname "INTERNALS*" -o -iname "CONTRIBUTING*" -o -iname "CHANGELOG*" \) \
    ! -path "*/node_modules/*" 2>/dev/null \
    | xargs grep -l -E "${KEYWORD}|${ALT_KEYWORDS}" 2>/dev/null
done
```

Junte os 3 conjuntos, deduplica, **ordene por caminho**. Esse é o inventário final.

#### Triagem do inventário

Para cada arquivo do inventário, classifique em uma das 4 categorias:

| Tag | Significado | Tratamento |
|---|---|---|
| `core` | implementação principal | Read inteiro, anota no output |
| `support` | helper / type / util usado pelo core | Read inteiro, anota |
| `test` | spec / fixture / golden | Read **seletivo** — extrai expectativas + casos |
| `doc` | RFC / CHANGELOG / README | Read inteiro — vira fonte de edge cases |

Arquivos `core` + `support` + `doc` vão para deep read (Passo 3). Arquivos `test` viram fonte de edge case enumeration (Passo 6).

**Nenhum arquivo é descartado sem justificativa explícita escrita no output.** Se você considera um arquivo irrelevante, ele entra na seção "Arquivos avaliados e descartados" com 1 frase explicando por quê. Isso evita o cherry-picking que distorce análise.

### Passo 3 — Deep read (NÃO grep apenas)

Para **todos** os arquivos do inventário (Passo 2) classificados como `core`, `support` ou `doc`, **leia o arquivo inteiro** (Read tool, sem offset). Arquivos `test` recebem read seletivo focado em `describe`/`it` headers + assertion shape.

Para cada arquivo lido, anote:

1. **API pública** — exports nomeados, tipos, defaults
2. **Algoritmo interno** — passo a passo do que o módulo FAZ, em prosa
3. **Estado/data structures** — quais Maps, Sets, classes carregam estado
4. **Dependências externas** — `import` de não-stdlib (`openai`, `zod`, `@modelcontextprotocol/sdk`, etc.)
5. **Side effects** — escreve filesystem? mexe em globals? injeta `<script>`?
6. **TODOs/FIXMEs/HACKs** — copie literalmente, com file:line
7. **Padrão de design** — Factory? Plugin? Middleware? Observer? Visitor?

Resultado: notas estruturadas por framework. Não passe para o Passo 4 sem ter feito leitura completa de pelo menos 3 arquivos por framework.

### Passo 4 — Catalogar dependências externas

**Esta etapa é o diferencial.** Quais libs npm/cargo/gem cada framework usa para resolver o problema?

```bash
# Filtra imports não-stdlib relevantes ao tópico
grep -rn "^import.*from ['\"][^./]" .claude/knowledge-base/reference/$FW --include="*.ts" 2>/dev/null \
  | grep -i "$KEYWORD" \
  | awk -F"'" '{print $2}' | awk -F'"' '{print $1}' \
  | sort -u
```

Para cada lib aparecer:
- **Nome** + versão pinada no `package.json` do framework
- **Função no contexto** (não a descrição genérica — o uso específico)
- **Possível adoção no SDK** (sim / não / avaliar)

Libs que aparecem em **2+ frameworks** são tipicamente ovos de ouro. Marque-as como "convergent dependency".

### Passo 5 — Extrair padrões

Padrões convergentes (todos fazem assim) e divergentes (cada um faz diferente). Para cada padrão:

- **Nome do padrão** (ex: "Per-request context via AsyncLocalStorage")
- **Quem usa** (com file:line)
- **Por que funciona**
- **Trade-off conhecido**

### Passo 6 — Catalogar edge cases

Como cada framework descobriu os edge cases? Olhe:

```bash
# Commits que mencionam fix/bug no tópico
cd .claude/knowledge-base/reference/$FW
git log --oneline --grep="$KEYWORD" --grep="fix\|hotfix\|bug" --all-match 2>/dev/null | head -30

# CHANGELOG entries
grep -i "$KEYWORD" "$fw"/CHANGELOG*.md 2>/dev/null | head -20

# Issues/RFCs no tree
find "$fw" -maxdepth 3 -name "RFC*" -o -name "DESIGN*" 2>/dev/null
```

Cada edge case vira uma linha na tabela de "Edge cases conhecidos" — com a fonte (commit hash ou changelog version).

### Passo 7 — Escrever o Implementation Guide

A seção mais importante do output. Estrutura obrigatória:

1. **Arquitetura proposta** — diagrama em ASCII (boxes + arrows)
2. **Files to create** — caminho exato dentro de `packages/`
3. **Public API surface** — assinatura TypeScript de cada export
4. **Dependências a adotar** — npm packages com versão alvo
5. **Test strategy** — quais arquivos de teste, quais cenários BDD
6. **Phases of rollout** — 2–4 fases incrementais
7. **Acceptance criteria** — checklist verificável
8. **Risks + mitigations**

Cada item da lista DEVE ser concretamente acionável — alguém abre o editor e começa.

---

## Estrutura do output — `.claude/knowledge-base/reference/{slug}.md`

```markdown
# Reference: {Topic}

**Date:** YYYY-MM-DD
**Depth:** exhaustive (default) | standard
**Frameworks analyzed:** [lista com versões / commit hash]
**SDK package affected:** [path]
**Related references:** [outros docs em .claude/knowledge-base/reference/ que tocam o assunto]

---

## 1. Problem statement

- **What:** {1 parágrafo — o que precisamos implementar no SDK e por quê}
- **Current state:** {o que já existe, parcialmente ou não}
- **Why now:** {gatilho — issue, plano, gap competitivo}

## 2. Inventário completo de arquivos (mandatório)

Lista exaustiva — todo arquivo que o grep capturou nas 3 passadas (nome / conteúdo / docs). Ordenado por framework e por caminho. **Sem cherry-picking.**

### {Framework} — inventário

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| `src/agents/run.py` | core | 412 | ✅ | §3.1 |
| `src/agents/_run_impl.py` | core | 187 | ✅ | §3.1 |
| `src/agents/items.py` | support | 98 | ✅ | §3.2 |
| `tests/test_run_step_processing.py` | test | 245 | seletivo | §7 |
| `docs/running_agents.md` | doc | 320 | ✅ | §4 |
| ... | ... | ... | ... | ... |

(uma tabela como esta para CADA framework do `.claude/knowledge-base/reference/`)

### Arquivos avaliados e descartados (com motivo)

| File | Why discarded |
|---|---|
| `tests/fixtures/trivial_agent.py` | Fixture trivial sem invariante — coberto pelo teste principal |
| `src/agents/_vendored/gen_pb2.py` | Generated code (saída de codegen) |
| ... | ... |

Nenhum arquivo "some omitted for brevity". Se foi removido da consideração, está nesta tabela.

## 3. Prior art — deep dive por framework

### {Framework} — version {x}.{y}.{z}

#### API pública
```ts
// {file:line}
export function foo(...): Bar { … }
export type Baz = …
```

#### Algoritmo interno (prosa, passo a passo)

1. {Passo 1, com file:line ancorado}
2. {Passo 2}
3. …

#### Estado mantido

- `{nome do Map/Set/Class}` em `{file:line}` — guarda {o quê} pelo motivo de {qual}

#### Dependências externas usadas

| Lib | Versão | Para quê | SDK pode adotar? |
|---|---|---|---|
| `gpt-tokenizer` | ^2.x | Contar tokens para decidir threshold de compaction | Sim / Não / Avaliar |

#### Side effects observáveis

- Escreve sessão/estado em disco (`~/.config/{tool}/...`)
- Emite spans de tracing / logs em stderr
- ...

#### TODOs / FIXMEs / HACKs literais

> `// FIXME: this loses precision when …` — `{file:line}`

#### Padrão de design

- Pattern: **Per-segment Factory + Plugin chain**
- Por que: {explicação em 1–2 frases}

(Repetir essa subsection para CADA framework analisado — openai-agents-python / pi / opencode / codex / etc.)

## 4. Convergent patterns (todos concordam)

1. **{Pattern X}** — adotado por: openai-agents-python ({file:line}), pi ({file:line}), opencode ({file:line}). Funciona porque {razão concreta}. **SDK deve adotar.**
2. ...

## 5. Divergent patterns (trade-off real)

1. **{Decision Y}**
   - openai-agents-python: faz `A` (file:line) — trade-off: {custos}
   - opencode: faz `B` (file:line) — trade-off: {custos}
   - **SDK choice:** `C porque {razão}`
2. ...

## 6. Dependency inventory — bibliotecas comuns

Convergent libs (aparecem em 2+ frameworks):

| Lib | Frameworks que usam | Função | SDK decision |
|---|---|---|---|
| `zod` | openai-agents-python, mastra | Schema de tool-input / structured output | **Adotar** (já é peer dep do SDK) |
| `gpt-tokenizer` | opencode, codex | Contagem de tokens p/ threshold de compaction | **Avaliar** |
| `eventsource-parser` | vercel-ai, opencode | Parse robusto de SSE | **Avaliar** |

## 7. Algorithms / data structures não-óbvios

- **{Algorithm name}** ({framework} {file:line}) — {descrição em 1 parágrafo + complexidade}
- **{Data structure name}** ({framework} {file:line}) — {por que essa estrutura, não a óbvia}

## 8. Edge cases conhecidos (com fonte)

| Edge case | Como manifesta | Onde foi corrigido | Como devemos prevenir |
|---|---|---|---|
| Provider vaza tool-call como texto (dialeto Hermes) em vez de `tool_calls` nativo | Call é perdida; loop vê `end_turn` | openai-agents-python / hermes-agent (recovery) | Parsear content no finish + gate por allowlist |
| ... | ... | ... | ... |

## 9. Implementation Guide

### 9.1 Arquitetura proposta

```
┌─────────────────────────┐
│  Agent.create/.send()   │   (public façade — packages/sdk/src/agent.ts)
└───────────┬─────────────┘
            │ drives
            ▼
┌─────────────────────────┐      ┌───────────────────────┐
│  agent-loop (loop.ts)   │─────▶│  tool-dispatch /       │
│                         │      │  tool-registry         │
└───────────┬─────────────┘      └───────────────────────┘
            │ calls
            ▼
┌─────────────────────────┐
│  internal/llm (router → │   (openai / anthropic / providers)
│  provider client, SSE)  │
└─────────────────────────┘
```

### 9.2 Files to create

```
packages/sdk/src/{feature}.ts                         — superfície pública (barrel via index.ts)
packages/sdk/src/internal/{area}/{module}.ts          — algoritmo interno (@internal)
packages/sdk/src/types/{feature}.ts                   — contrato de tipo público (espelhado em docs.md)
packages/sdk/tests/internal/{area}/{module}.test.ts   — unit TDD (Vitest)
packages/sdk/tests/integration/{module}.test.ts       — boundary real (pool forks+singleFork)
packages/sdk/tests/golden/{area}/{module}.golden.test.ts — golden (SSE/fixture → accumulator → finish)
```

### 9.3 Public API surface (TypeScript)

```ts
export function defineXxx<...>(...): XxxConfig<...> { … }   // factory function — API canônica (Regra 9)

export interface XxxOptions {
  ...
}

export type XxxHandler = (ctx: XxxContext) => ...
```

### 9.4 Dependências a adotar

| Package | Version | Justification |
|---|---|---|
| `zod` | peer `^3.25 \|\| ^4` | Schema de tool-input / structured output (já é peer opcional do SDK) |
| _(nenhuma)_ | — | Preferir stdlib / código puro — o SDK usa `fetch` nativo, sem deps HTTP |

(ou "nenhuma — implementação fica em pure TS"; toda dep nova passa por `/deps-audit` + parsimony ladder)

### 9.5 Test strategy

- **Unit:** `packages/sdk/tests/internal/{area}/{module}.test.ts` — N cenários BDD
  - Happy path
  - Validation error (typed error + mensagem — ver `rules/error-handling.md`)
  - Edge case + negative case (lista os do passo 7 — ver `rules/testing.md § 4.1`)
  - Error scenario
- **Integration:** `packages/sdk/tests/integration/{module}.test.ts` (pool forks+singleFork)
- **Golden (se stream/LLM):** `packages/sdk/tests/golden/{area}/{module}.golden.test.ts` — SSE/fixture → accumulator → finish
- **Real-LLM (se toca `agent.send`/embeddings):** validar com provider real via OpenRouter — ver `rules/real-llm-validation.md` (fixture mode NÃO conta como validação)

### 9.6 Phases of rollout

1. **Phase 1 — Core API + unit tests** (target: green TDD)
2. **Phase 2 — Wiring triad** (caller no agent-loop/runtime + integration test + runtime metric)
3. **Phase 3 — Golden + real-LLM validation** (target: golden green + provider real)
4. **Phase 4 — Migration / opt-out** (se quebrar API existente — atualizar `docs.md` + `CHANGELOG.md`)

### 9.7 Acceptance criteria

- [ ] {Critério 1 verificável}
- [ ] {Critério 2}
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] `docs.md` atualizado (se muda superfície pública) + `CHANGELOG.md` `[Unreleased]`
- [ ] Real-LLM validado quando aplicável (`rules/real-llm-validation.md`)

### 9.8 Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| {risco concreto} | high/med/low | {fix preventivo} |

## 10. Open questions

Itens onde a pesquisa NÃO chegou em resposta. Cada um vira um TODO antes de começar a implementação.

1. {Pergunta} — possíveis caminhos: A / B
2. ...

## 11. Referências citadas (todos os arquivos do inventário)

Toda âncora `file:line` usada no documento aparece aqui, agrupada por framework. Esta seção é o índice reverso do inventário — permite navegar do conceito de volta ao código fonte.

### {Framework}

#### Core
- `src/agents/run.py:1-412` — orquestração principal do run loop; referenciada em §3.1 (algoritmo), §4 (pattern X), §7 (data structure Y)
- `src/agents/_run_impl.py:1-187` — processamento de step / tool-call; §3.1, §8 (edge case Z)

#### Support
- `src/agents/items.py:1-98` — modelos de item (message/tool_call/output); §3.2

#### Test (read seletivo)
- `tests/test_run_step_processing.py:42-78` — cobre recovery de tool-call vazado (cenário em §8)
- `tests/test_run_step_processing.py:120-145` — cobre dedup native vs recovered (cenário em §8)

#### Doc / RFC / CHANGELOG
- `docs/running_agents.md:1-320` — doc de arquitetura do run; §4 (decisão de handoff)
- `CHANGELOG.md` v0.x — fix do tool-call vazado; §8

#### Commits relevantes (git arqueologia)
- `abc123def` (2024-01-15) — "fix: recover tool call leaked as text content" — §8
- `7890abcd1` (2024-02-03) — "perf: skip content scan when native tool_calls present" — §7

(repetir essa estrutura para CADA framework do inventário)

### URLs externas

- {URL} — {o que mostra, por que importa}
```

Toda asserção no documento DEVE estar ancorada num item desta seção 11. Sem fonte, sem afirmação.

---

## Quality bar

Toda execução (default `exhaustive`, ou `standard` quando explicitamente passado) DEVE produzir:

- [ ] Discovery dinâmica de `.claude/knowledge-base/reference/*/` (não hardcoded)
- [ ] **Inventário completo de arquivos por framework** — todos os hits das 3 passadas (nome + conteúdo + docs), triados em `core` / `support` / `test` / `doc`, sem cherry-picking
- [ ] **Seção "Arquivos avaliados e descartados"** com 1 frase de justificativa por arquivo removido — se a seção está vazia OU se tem "..." no final, o inventário está incompleto
- [ ] Mínimo **3 frameworks** com deep-read (TODOS os arquivos `core` + `support` + `doc` lidos inteiros por framework)
- [ ] Tabela de dependências externas com versão pinada
- [ ] Mínimo **5 padrões** identificados (convergent + divergent)
- [ ] Mínimo **5 edge cases** com fonte (commit hash ou CHANGELOG) — fontes vêm dos arquivos `test` + `doc` do inventário
- [ ] Implementation Guide com **todas as 8 subsections** preenchidas
- [ ] Lista de open questions (mínimo 2 — se zero, a pesquisa foi rasa demais)
- [ ] **Seção 11 (Referências citadas) contém TODOS os arquivos do inventário** (não apenas os "principais"), agrupados por framework, com line range e cross-reference para as seções que os citam
- [ ] Toda asserção no documento ancorada num `file:line` da seção 11 — nenhuma afirmação solta
- [ ] Output em `.claude/knowledge-base/reference/{slug}.md`

Se qualquer item falhar, a skill **NÃO termina** — volta ao passo correspondente.

### Verificação automática antes de finalizar

```bash
SLUG="<topic-kebab>"
DOC=".claude/knowledge-base/reference/$SLUG.md"

# 1. Inventário completo — toda linha "core|support|test|doc" no inventário aparece na seção 11
INV_FILES=$(awk '/^## 2\. Inventário/,/^## 3\./' "$DOC" | grep -oE '`[^`]+\.[a-z]+`' | sort -u)
REF_FILES=$(awk '/^## 11\. Referências/,/^$/' "$DOC" | grep -oE '`[^`]+\.[a-z]+' | sort -u)
diff <(echo "$INV_FILES") <(echo "$REF_FILES") || echo "FAIL: arquivos do inventário não citados na §11"

# 2. Sem "..." na seção de descartados (placeholder de preguiça)
grep -A 999 "## 2\." "$DOC" | grep -B 1 "^## 3\." | grep -q "\.\.\." && \
  echo "FAIL: inventário tem reticências — completar antes de finalizar"
```

---

## Anti-patterns

- **Grep-and-dump.** Pegar `grep` results e colar no doc sem ler o código não conta como deep dive.
- **API surface sem prosa.** Listar `export function foo()` sem explicar O QUE foo faz é inútil para quem vai implementar.
- **"TODO: investigate"** no Implementation Guide. Se está como TODO, ainda é Passo 3, não Passo 7.
- **Ignorar dependências externas.** A seção 6 é onde mora o tempo poupado — bibliotecas que outros já vetaram resolvem 60% do trabalho.
- **Implementation Guide vago.** "Implementar módulo X" não é guide. "Criar `packages/sdk/src/internal/llm/hermes-tool-extract.ts` com `export function extractHermesToolCalls(content, allowedNames): ToolCall[]`, chamado no `finish()` de `openai.ts`" é guide.
- **Pular open questions.** Pesquisa sem dúvidas é pesquisa rasa. Se não restou pergunta, leu superficialmente.
- **Inventário com `...` / "principais arquivos" / "alguns omitidos".** Cherry-picking distorce a análise — quem lê o doc depois não sabe se um arquivo foi ignorado por irrelevância ou por preguiça. Ou cita todos, ou justifica o descarte na seção dedicada. Não há terceira via.
- **Referência sem âncora `file:line`.** "openai-agents-python faz X" sem `src/agents/run.py:42` é folclore. Toda asserção do documento aponta para a seção 11.

---

## Tópicos comuns + keywords + peers-alvo

Domínio: **harness de agentes** (`@theokit/sdk`). Os peers são SDKs/runtimes de agente clonados sob `.claude/knowledge-base/reference/`. A coluna "Área SDK" indica onde o módulo equivalente costuma cair (confirme com grep — não hardcode).

| Tópico | Keywords | Peers-líder a ler | Área SDK |
|---|---|---|---|
| `agent loop / iteration` | `run, loop, step, iteration, turn, max_turns` | openai-agents-python, pi, opencode, codex | `internal/agent-loop/loop.ts` |
| `tool-call dispatch` | `tool, function-call, dispatch, execute, tool_choice` | openai-agents-python, opencode, pi | `internal/tool-dispatch/`, `define-tool.ts` |
| `leaked tool-call / dialect recovery` | `hermes, function=, tool-call-repair, safe-parse` | hermes-agent, openclaw, opencode | `internal/llm/hermes-tool-extract.ts`, `openai.ts` |
| `structured output` | `structured, json-schema, response_format, generate-object` | openai-agents-python, mastra | `generate-object.ts`, `stream-object.ts` |
| `streaming / SSE` | `stream, sse, delta, accumulator, event-stream` | openai-agents-python, opencode | `internal/llm/sse.ts`, `stream-relay.ts` |
| `multi-provider LLM client` | `provider, router, openai, anthropic, fallback, base-url` | pi, openai-agents-python | `internal/llm/{router,openai,anthropic}.ts`, `internal/providers/` |
| `subagents / handoffs` | `handoff, delegate, subagent, crew, transfer` | openai-agents-python, crewAI, adk-js | `subagents.ts`, `squad.ts` |
| `MCP servers/clients` | `mcp, model-context-protocol, stdio, tools/list` | openai-agents-python, codex, opencode | `internal/mcp/`, `server/` |
| `hooks / lifecycle` | `hook, on_start, on_end, pre/post, lifecycle` | opencode, codex, pi | `internal/runtime/hooks/` |
| `permissions / sandbox` | `permission, approval, allow/deny, sandbox, exec` | codex, opencode | `permission-engine.ts`, `sandbox/`, `internal/security/` |
| `context compaction` | `compaction, summarize, truncate, token-budget, window` | openai-agents-python, opencode | `compaction.ts`, `internal/runtime/compression/` |
| `memory` | `memory, recall, embedding, vector, dreaming` | mastra, crewAI | `memory.ts`, `internal/memory/`, `packages/sdk-memory` |
| `eval / scorers` | `eval, scorer, grade, dataset, verify-gate` | openai-agents-python, mastra | `eval.ts`, `scorers.ts`, `internal/eval/` |
| `retry / resilience` | `retry, backoff, fallback, credential-pool, circuit` | pi, openai-agents-python | `retry.ts`, `internal/llm/{retry,fallback-client}.ts` |
| `persistence / sessions` | `session, persist, resume, jsonl, sqlite, atomic` | opencode, codex | `persistence.ts`, `internal/runtime/session/` |
| `observability / tracing` | `otel, trace, span, metric, telemetry` | openai-agents-python, mastra | `internal/observability/`, `internal/telemetry/` |
| `budget / cost` | `budget, cost, usage, tokens, cap` | opencode, codex | `budget.ts`, `internal/agent-loop/usage-and-cost.ts` |
| `cron / scheduling` | `cron, schedule, job, queue, wakeup` | crewAI (flows) | `cron.ts`, `internal/cron/`, `job-queue.ts` |
| `subscription / resume tokens` | `subscribe, resume, lastEventId, websocket, tracked` | openclaw, opencode | `subscription/` |
| `error handling / typed errors` | `error, typed, TheokitAgentError, fail-fast` | openai-agents-python, pi | `errors.ts`, `internal/error-mappers/` |
| `doom-loop / no-progress` | `loop-detection, repeat, no-progress, stuck` | opencode, cline | `internal/agent-loop/doom-loop-tracker.ts` |

---

## Integração com outras skills

| Skill | Quando usar |
|---|---|
| `/to-research` | DEPOIS de `to-reference`: web search + RFCs + benchmarks publicados |
| `/to-plan` | Consome `.claude/knowledge-base/reference/{slug}.md` direto na seção "Implementation Guide" |
| `/edge-case-plan` | Cruza com os edge cases catalogados no passo 7 |
| `/meeting` | Decisões com trade-off divergente vão pra reunião com o doc anexo |

---

## Clonagem de referências (uma vez por máquina)

Os peers vivem em `.claude/knowledge-base/reference/`. Alguns já estão versionados no repo; os demais cada dev clona localmente (parte do diretório é gitignored per-dev — verifique `.gitignore` antes de commitar um novo clone). Como `@theokit/sdk` é um harness de **agentes**, os peers são SDKs/runtimes de agente, não web frameworks. Peers já presentes com conteúdo (remote verificado):

```bash
cd /home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk
mkdir -p .claude/knowledge-base/reference && cd .claude/knowledge-base/reference

git clone --depth 1 https://github.com/openai/openai-agents-python.git openai-agents-python
git clone --depth 1 https://github.com/earendil-works/pi.git            pi
git clone --depth 1 https://github.com/openai/codex.git                 codex
git clone --depth 1 https://github.com/google/adk-js.git                adk-js
git clone --depth 1 https://github.com/crewAIInc/crewAI.git             crewAI
# ...clone outros peers conforme o tópico exigir (mastra, opencode, hermes-agent, openclaw, cookbook).
```

Antes de commitar um clone novo, confirme se ele deve ficar versionado ou entrar no `.gitignore` (o diretório hoje mistura ambos).

---

## Exemplo de invocação

```
/to-reference streaming tool-call recovery
```

Espera-se:
1. Discovery: lista os peers com machinery de tool-call/streaming no source (`pi`, `openai-agents-python`, `opencode`, ...)
2. Deep read em `.claude/knowledge-base/reference/openai-agents-python/...` (accumulator + finish semantics)
3. Comparação com `.claude/knowledge-base/reference/pi/` (multi-provider LLM API) e `.claude/knowledge-base/reference/opencode/` (loop/tool dispatch)
4. Output: `.claude/knowledge-base/reference/streaming-tool-call-recovery.md` com Implementation Guide concreto para `packages/sdk/src/internal/llm/` (ou decisão fundamentada de NÃO adotar, com risk analysis).
