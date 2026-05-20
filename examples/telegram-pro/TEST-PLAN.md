# Roteiro de Teste — Telegram Pro

Teste completo de produção. Execute em ordem; cada fase é independente.

**Bot rodando**: `@theo_paulo_bot` (id `8982152421`)
**Workspace limpo**: `.theokit/` deletado, próximo `/start` cria agente fresco

---

## Como usar este roteiro

Pra cada passo:
1. **Manda** → o texto/comando exato
2. **Espera** → como o bot deve responder
3. ✅ **Sucesso** → o que precisa estar verdade pra considerar passou
4. 🔍 **Log** → o que olhar no terminal do bot se algo não bater

Se algum passo falhar, **pula pro próximo** e anota no final. Não fica preso.

---

## Fase 0 — Boot + identidade (1 minuto)

### 0.1 — Conexão

| Passo | Detalhe |
|---|---|
| 🎯 | Abre Telegram, conversa com `@theo_paulo_bot` |
| 📤 Manda | `/start` |
| 📥 Espera | Boas-vindas + seu user-id + agent-id `tg-pro-dm-<seu-id>` |
| ✅ Sucesso | Vê o agent-id no formato `tg-pro-dm-<num>` |
| 🔍 Log | `user=<seu-id> chat=private text=/start` |

### 0.2 — Help

| Passo | Detalhe |
|---|---|
| 📤 Manda | `/help` |
| 📥 Espera | Lista com 11 comandos: `/start /help /me /recall /wiki /agents /skills /summary /cron /remind /reset` |
| ✅ Sucesso | Todos os 11 estão lá + a seção "Modes detected automatically" |

---

## Fase 1 — Memória + Persistência (3 minutos)

### 1.1 — Auto-write via "Remember:"

| 📤 | `Remember: meu time é Corinthians` |
|---|---|
| 📥 | Confirmação ("Got it" ou similar) |
| ✅ | Aparece o fato salvo |
| 🔍 | No disco: `.theokit/memory/MEMORY.md` deve ter `- meu time é Corinthians` |

### 1.2 — Mais um fato

| 📤 | `Remember: meu editor favorito é Helix` |
|---|---|
| ✅ | Mesma confirmação |

### 1.3 — Listar fatos (sem LLM)

| 📤 | `/me` |
|---|---|
| 📥 | `1. meu time é Corinthians\n2. meu editor favorito é Helix` (ou similar) |
| ✅ | Os 2 fatos aparecem numerados |

### 1.4 — Recall de sessões via memory_search

| 📤 | `/recall corinthians` |
|---|---|
| 📥 | Encontra a conversa onde você mencionou Corinthians |
| ✅ | LLM cita o turn anterior, NÃO diz "memory_search não disponível" |
| 🔍 | `[bot] result status=finished` no log |

### 1.5 — LLM usa memória em conversa natural

| 📤 | `Sugere uma decoração de quarto baseada nas minhas preferências` |
|---|---|
| 📥 | LLM relaciona Helix ou Corinthians de alguma forma |
| ✅ | Resposta não é genérica — incorpora os fatos |

---

## Fase 2 — Filesystem + Shell + Policy (3 minutos)

### 2.1 — Shell tool: list directory

| 📤 | `Lista os arquivos do diretório atual` |
|---|---|
| 📥 | Lista incluindo `package.json`, `src`, `README.md`, `.theokit`, etc. |
| ✅ | Vê os arquivos reais do workspace, NÃO inventa |

### 2.2 — Policy hook block (CRÍTICO)

| 📤 | `roda rm -rf /` |
|---|---|
| 📥 | Bot recusa e cita a policy: "Policy denied" ou similar |
| ✅ | **NÃO executa**. Vê palavra "blocked", "policy", ou "denied" na resposta |
| 🔍 | Log NÃO mostra arquivos sumindo |

### 2.3 — MCP write_file (action bias)

| 📤 | `Cria notas.md com 5 itens da minha lista de compras` |
|---|---|
| 📥 | "Criei notas.md com [5 itens]" — escolhe sozinho (leite, pão, etc.) |
| ✅ | **NÃO pergunta** "qual conteúdo?". Arquivo `notas.md` aparece no diretório |
| 🔍 | `cat /home/paulo/Projetos/usetheo/theokit-sdk/examples/telegram-pro/notas.md` mostra 5 linhas |

### 2.4 — MCP read_text_file

| 📤 | `Lê o package.json e me diz qual a versão do TypeScript` |
|---|---|
| 📥 | Resposta com a versão (ex: `^5.8.0`) |
| ✅ | Cita um número de versão real |

### 2.5 — Cria + lê outro arquivo

| 📤 | `Cria diario.md com 3 itens do dia de hoje em formato bullet` |
|---|---|
| 📥 | Confirma criação |
| 📤 | `Que arquivos .md tem no diretório?` |
| 📥 | Lista incluindo notas.md + diario.md |
| ✅ | Both visíveis |

---

## Fase 3 — Vision multi-modal (2 minutos)

### 3.1 — Sticker estático

| 📤 | (manda QUALQUER sticker estático — não animado) |
|---|---|
| 📥 | Descrição em 1-2 frases do que vê |
| ✅ | Descrição específica (cor, emoção, forma) — NÃO genérica |
| 🔍 | `[sticker] described (cached=false) in XXXms: ...` |

### 3.2 — Mesmo sticker (cache hit)

| 📤 | (manda o MESMO sticker de novo) |
|---|---|
| 📥 | Mesma descrição (ou continuação) |
| ✅ | Resposta vem em <1s |
| 🔍 | `[sticker] described (cached=true) in 0ms: ...` ← **cache hit** |

### 3.3 — Foto com caption

| 📤 | (foto qualquer com legenda) `"isso parece um cachorro?"` |
|---|---|
| 📥 | Resposta baseada no que VÊ + a pergunta |
| ✅ | Combina ambas — não ignora a foto nem a caption |

---

## Fase 4 — Inline Buttons (2 minutos)

### 4.1 — Forçar buttons em conversa

| 📤 | `Sugere 3 restaurantes em São Paulo` |
|---|---|
| 📥 | Lista 3 opções **com botões clicáveis abaixo** |
| ✅ | Aparecem 3 botões tipo `[Restaurante A]` `[Restaurante B]` `[Restaurante C]` |

### 4.2 — Tap continua a conversa

| 📤 | (toca um dos botões) |
|---|---|
| 📥 | Bot continua naturalmente como se você tivesse digitado |
| ✅ | NÃO pede pra você "escolher de novo" |
| 🔍 | Log: `text=[user tapped button: ...]` |

### 4.3 — Caso destrutivo (yes/no)

| 📤 | `Quero apagar todas minhas notas` |
|---|---|
| 📥 | Bot oferece `[Sim] [Não]` ou similar |
| ✅ | Aparecem botões de confirmação |
| 📤 | (toca "Não") |
| 📥 | Bot confirma que não apagou |

---

## Fase 5 — Skills + Subagents + Wiki (3 minutos)

### 5.1 — Listar skills

| 📤 | `/skills` |
|---|---|
| 📥 | 2 skills: `recipe-suggest` + `morning-routine` com descrições |
| ✅ | Ambas aparecem, descrição completa |

### 5.2 — Skill em ação

| 📤 | `me sugere uma receita rápida pro jantar` |
|---|---|
| 📥 | LLM dá uma receita estruturada (ingredients + steps) |
| ✅ | Format minimamente segue o skill (não é apenas texto livre) |

### 5.3 — Subagents (honesto sobre cloud-only)

| 📤 | `/agents` |
|---|---|
| 📥 | Lista `code_writer` + `researcher` + **disclaimer "cloud-only no v1.0"** |
| ✅ | A mensagem é honesta sobre limitação |

### 5.4 — Wiki search (server-side)

| 📤 | `/wiki tools` |
|---|---|
| 📥 | Excerpt do `tools.md` com lista de tools disponíveis |
| ✅ | Vê o conteúdo formatado em code block |

### 5.5 — Wiki second file

| 📤 | `/wiki deployment` |
|---|---|
| 📥 | Excerpt do `deployment.md` com notas de deploy |
| ✅ | Conteúdo aparece (não "não há entrada") |

### 5.6 — Wiki miss

| 📤 | `/wiki blockchain` |
|---|---|
| 📥 | `Não há entrada na wiki sobre "blockchain".` |
| ✅ | Resposta clara de miss, NÃO inventa conteúdo |

---

## Fase 6 — Cron + Dreaming (3 minutos)

### 6.1 — Lista cron jobs

| 📤 | `/cron` |
|---|---|
| 📥 | Pelo menos 1 job: `tg-pro:nightly-dream` agendado pra `0 3 * * *` |
| ✅ | Próxima execução visível |

### 6.2 — Cria reminder

| 📤 | `/remind */2 * * * * \| beba água` |
|---|---|
| 📥 | "Reminder scheduled: cron-..." + próximo fire |
| ✅ | ID retornado começa com `tg-pro:remind:` |

### 6.3 — Reminder dispara (espera 2 min)

| ⏰ | (Aguarda 2 minutos sem fazer nada) |
|---|---|
| 📥 | Log mostra cron fire — NÃO precisa ser entrega Telegram (o reminder dispara `agent.send` interno) |
| 🔍 | Log: `[bot] result status=finished` em horário par |

### 6.4 — Dreaming sweep on-demand

| 📤 | `/summary` |
|---|---|
| 📥 | Status: `Sweep status: ok` + estatísticas (facts before/after, duplicates removed, clusters) |
| ✅ | Pelo menos `Facts: 2 → 2` (não pode regredir) |
| 🔍 | `.theokit/memory/notes/` deve ter um arquivo `cluster-XXX.md` |

### 6.5 — Remove reminder

| 📤 | `/cron` (anota o ID do reminder) |
|---|---|
| 📤 | (se quiser parar antes de continuar): em outro terminal, `rm -rf .theokit/cron/jobs.json` e restart bot. Pula esse passo se não tiver acesso. |

---

## Fase 7 — Reset + Restart-proof (4 minutos)

### 7.1 — Reset thread

| 📤 | `/reset` |
|---|---|
| 📥 | "Thread cleared. Memory facts preserved" |
| ✅ | Confirma reset SEM apagar /me facts |

### 7.2 — Verifica /me preservado

| 📤 | `/me` |
|---|---|
| 📥 | Ainda mostra Corinthians + Helix |
| ✅ | Fatos sobreviveram ao reset |

### 7.3 — `/start` fresh thread

| 📤 | `/start` |
|---|---|
| 📥 | Boas-vindas (thread nova, mas user-id mesmo) |
| ✅ | Funciona — `/me` continua mostrando os fatos |

### 7.4 — Restart-proof (CRÍTICO — precisa terminal)

| 🛠️ | No terminal do bot: `Ctrl+C` |
|---|---|
| 📥 | Bot mostra "Shutting down — your data is safe on disk" |
| 🛠️ | `pnpm dev` (reinicia) |
| 📥 | Bot reconecta — log "Connected as @theo_paulo_bot" |
| 📤 | (no Telegram, sem fazer /start) `me lembra do meu time?` |
| 📥 | LLM responde "Corinthians" — **prova que o restart preservou estado** |
| ✅ | **Memória sobreviveu kill-9 + restart** |

---

## Fase 8 — Error display (1 minuto)

### 8.1 — Forçar rate-limit (opcional)

| 📤 | Manda 10-15 mensagens rápidas em <30s |
|---|---|
| 📥 | Eventualmente: `⚠️ Run falhou sem evento (provavelmente rate-limit do OpenRouter...)` |
| ✅ | Mensagem **clara em PT** sobre rate-limit (não "(run error)" sem detalhe) |

### 8.2 — Verifica log estruturado

| 🔍 | No log do bot, runs que falharam têm: `[bot] run failed (error/<code>): <mensagem>` |
|---|---|
| ✅ | Códigos visíveis: `agent_loop_failed`, `mcp_init_failed`, etc. |

---

## Fase 9 — Grupo + Forum (OPCIONAL, 5 min)

> Pula se não quiser configurar grupo agora.

### 9.1 — Cria grupo + adiciona bot

1. No Telegram: `+ New Group` → nome qualquer
2. Add member: `@theo_paulo_bot`
3. (Ainda no Telegram) `@BotFather` → `/mybots` → `@theo_paulo_bot` → `Bot Settings` → `Group Privacy` → **Disable**

### 9.2 — Bot fica calado sem mention

| 📤 | (no grupo) `oi pessoal` |
|---|---|
| 📥 | Bot **não responde** |
| ✅ | Group policy ativa |

### 9.3 — Bot responde com mention

| 📤 | (no grupo) `@theo_paulo_bot oi` |
|---|---|
| 📥 | Bot responde |
| ✅ | Mention gating funciona |

### 9.4 — Forum topics (CONFIG do grupo)

1. Long-press no nome do grupo → `Edit` → liga `Topics`
2. Cria topic `#trabalho` e `#casa`

### 9.5 — Topics isolados

| 📤 | (no #trabalho) `@theo_paulo_bot meu projeto se chama Apollo` |
|---|---|
| 📥 | Bot confirma |
| 📤 | (no #casa) `@theo_paulo_bot qual nome do projeto?` |
| 📥 | Bot **não sabe** (sessão diferente) |
| ✅ | Topics são threads isoladas |
| 📤 | (volta ao #trabalho) `@theo_paulo_bot qual nome do projeto?` |
| 📥 | Bot responde "Apollo" |

---

## Critério de aceitação final

Pra considerar **production-ready**:

- ✅ Fases 0-7 todas passam (8 e 9 são opcionais)
- ✅ Bot sobrevive `kill -9` com memória + sessões preservadas
- ✅ Policy hook bloqueia `rm -rf /`
- ✅ Action-bias funciona (`Cria X com Y` não pergunta)
- ✅ `/wiki` funciona deterministicamente (server-side)
- ✅ Vision cache visível (segundo sticker em <1s)
- ✅ Mensagens de erro são informativas (`/recall`, run errors)

**Se TODOS os critérios acima passarem, o bot está production-ready.**

---

## Como reportar bugs

Pra cada falha, abra issue ou me manda:

```
### Fase X.Y — <título do passo>
**Esperava**: <resposta esperada>
**Aconteceu**: <resposta real>
**Log**: <linha do log com [bot] ... ou [voice]/[sticker]/etc>
**Reprodução**: <texto exato mandado>
```

---

## Estado dos arquivos durante o teste

```
examples/telegram-pro/
├── notas.md                            ← criado em 2.3
├── diario.md                           ← criado em 2.5
└── .theokit/
    ├── agents/
    │   ├── registry.json               ← stale-free agora
    │   └── tg-pro-dm-<userId>/messages.jsonl
    ├── memory/
    │   ├── MEMORY.md                   ← Corinthians + Helix
    │   ├── sessions/<runId>.md         ← 1 por run finished
    │   ├── notes/cluster-XXX.md        ← criado por /summary
    │   └── wiki/
    │       ├── tools.md
    │       └── deployment.md
    ├── cache/vision/<sha>.txt          ← descriptions cache
    ├── hooks.json                      ← policy hook
    ├── policy.js
    ├── skills/recipe-suggest/SKILL.md
    ├── skills/morning-routine/SKILL.md
    ├── plugins.json
    └── context.json
```

Inspeciona qualquer arquivo durante o teste com `cat` ou `tree .theokit`.
