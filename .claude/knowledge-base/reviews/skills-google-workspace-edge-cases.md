# Edge Case Review — skills-google-workspace

Data: 2026-05-25
Tasks analisadas: 9 (T0.1, T1.1, T2.1, T2.2, T3.1, T4.1, T5.1, T5.2, T6.1)
Edge cases encontrados: 10 (MUST FIX: 1, SHOULD TEST: 4, DOCUMENT: 5)

## MUST FIX

### EC-1: Usuário baixa credenciais OAuth do tipo errado (Web em vez de Desktop)
- **Task afetada:** T3.1 (`theokit setup gworkspace`)
- **Família:** Format / Input
- **Cenário:** Google Cloud Console oferece três tipos de OAuth client: Web application, Desktop application, e Service account. Quem nunca fez isso antes clica no primeiro (Web). O JSON resultante tem shape `{ web: { client_id, redirect_uris, ... } }` em vez de `{ installed: { client_id, redirect_uris, ... } }`. Os três MCP servers escolhidos esperam o shape "installed" (Desktop) e vão falhar mid-agent-loop com mensagens crípticas tipo "client_id undefined".
- **Impacto:** UX terrível. Usuário rodou `theokit setup gworkspace`, viu "OK", e só descobre o problema 10 minutos depois quando a primeira chamada de tool falha sem explicação clara. Diagnóstico requer ler o README do MCP server.
- **Fix sugerido:** Em `setup/gworkspace.ts`, após validar JSON parse, checar `if (!parsed.installed) { throw new Error("This looks like a 'Web application' OAuth client. Re-create as 'Desktop application' in Google Cloud Console."); }`. 3 linhas.

---

## SHOULD TEST

### EC-2: `credentials.json` malformado (JSON inválido)
- **Task afetada:** T3.1
- **Teste sugerido:** `test_setup_gworkspace_malformed_credentials_exits_2_with_parse_error` — escreve `{not valid json` no path, espera exit 2 com mensagem mencionando "parse error" + o file path. O plano cita esse caso em Deep Dives mas não lista no TDD.

### EC-3: `--probe` trava se MCP server não responde ao `initialize`
- **Task afetada:** T3.1 (`--probe` mode)
- **Teste sugerido:** `test_probe_timeout_per_server_10s` — fake MCP server que aceita conexão e nunca responde; probe deve abortar após 10s com mensagem "server X did not respond to initialize within 10s". Sem isso, probe trava indefinidamente em servers quebrados.

### EC-4: Recipe 6 (combined-meeting-doc) tenta escrever Drive sem ter token com `drive.file` scope
- **Task afetada:** T5.2
- **Teste sugerido:** Não é teste automatizado (recipes não têm testes — convenção), mas o recipe DEVE catch o 403 do Drive e imprimir mensagem clara: `Drive write rejected — re-run 'theokit setup gworkspace --writable=drive' to grant scope`. Adicionar ao código do recipe + README troubleshooting.

### EC-5: `products: ["calendar", "calendar"]` (duplicata)
- **Task afetada:** T2.1 (factory)
- **Teste sugerido:** `test_factory_dedup_duplicate_products` — `googleWorkspace({ products: ["calendar", "calendar"] })` retorna apenas UMA entrada `gworkspace-calendar`. Fix: `Array.from(new Set(products))` antes do loop. Já é padrão estabelecido (EC-6 do email gateway).

---

## DOCUMENT

### EC-6: `chmod 600` falha silenciosamente no Windows / FAT32 / outros sistemas sem POSIX
- **Risco aceito:** O SDK já documenta isso em `internal/mcp/token-storage.ts` (line 22): "chmod 600 where POSIX". Reusar o mesmo pattern — try/catch `chmod` e emitir warning não-fatal. Não é um problema novo desta package.

### EC-7: Chave do factory colide com `mcpServers` pré-existente do usuário
- **Risco aceito:** Naming convention `gworkspace-*` torna colisão improvável. Se acontecer, o spread literal `{...googleWorkspace(), ...userMcp}` resolve com a ordem que o usuário escolher. Documentar no README: "se você já usa o prefixo `gworkspace-`, renomeie ou contate-nos".

### EC-8: Dois MCP servers diferentes expõem ferramentas com o mesmo nome
- **Risco aceito:** Os três servers escolhidos têm nomes próprios per-product (`list_events`, `search_drive_files`, `read_sheet`). Risco só materializa se Phase 0 trocar para um combined server. Documentar a suposição no `README` + ADR D342 footnote. Se acontecer, MCP machinery do SDK já faz dedup com warning (`Provider "x" overridden by user plugin.` pattern).

### EC-9: Primeira execução de cada recipe trava esperando consentimento OAuth no browser
- **Risco aceito:** Já reconhecido em D345. Reforçar no README do `examples/skills-google-workspace/`: "Run `theokit setup gworkspace --probe` ANTES de rodar recipes — força cada server a passar pelo OAuth consent up-front no terminal em vez de mid-recipe".

### EC-10: `Agent.batch` com concorrência alta spawna N×3 child processes MCP
- **Risco aceito:** Comportamento herdado do SDK MCP machinery (não é específico de gworkspace). Cada server consome ~50MB. `Agent.batch({ concurrency: 10 })` × 3 servers = 30 processes × 50MB ≈ 1.5GB. Mencionar no Troubleshooting do README com sugestão: "se você roda em batch, considere `concurrency: 4` (default) ou crie um único agent compartilhado em vez de um por prompt".

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 0 | 1 (EC-5) | 1 (EC-7) |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 3 | 1 (EC-1) | 2 (EC-2, EC-3) | 1 (EC-6) |
| T4.1 | 0 | 0 | 0 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 4 | 0 | 1 (EC-4) | 3 (EC-8, EC-9, EC-10) |
| T6.1 | 0 | 0 | 0 | 0 |
| **Total** | **10** | **1** | **4** | **5** |

**Veredicto:** PLANO PRECISA DE AJUSTE — 1 MUST FIX (EC-1) + 4 SHOULD TEST (EC-2 a EC-5). Os 5 DOCUMENT são aceites conscientemente. Os ajustes são pequenos (frases nos testes + 3 linhas no setup) e não mudam a arquitetura do plano.
