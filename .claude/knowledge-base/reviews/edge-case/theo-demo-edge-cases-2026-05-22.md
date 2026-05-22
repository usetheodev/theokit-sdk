# Edge Case Review — theo-demo

Data: 2026-05-22
Tasks analisadas: 13 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1, T6.1, T7.1, T8.1, T9.1, T9.2, T10.1, T11.1)
Edge cases encontrados: 15 (MUST FIX: 5, SHOULD TEST: 7, DOCUMENT: 3)

## MUST FIX

### EC-1: Bin name collision entre `theokit` (framework) e `@usetheo/cli`
- **Task afetada:** T0.1 (deps), T8.1 (spawn CLI)
- **Família:** Integration
- **Cenário:** O framework `theokit@0.1.0-alpha.5` declara `"bin": { "theokit": "./dist/cli/index.js" }`. O `@usetheo/cli@0.1.0` (workspace dep) declara o **mesmo** `"bin": { "theokit": "./dist/bin/theokit.js" }`. Ao instalar ambos como deps de `apps/theo-demo`, `pnpm` cria `node_modules/.bin/theokit` apontando para uma das duas implementações (último a vencer; pnpm@9 frequentemente avisa mas não bloqueia). T8.1 chama `pnpm exec theokit eval` — pode resolver pro framework, que **não tem** subcommand `eval`, e o eval simplesmente falha em runtime.
- **Impacto:** Phase 8 inteiro fura silenciosamente. Pior: `theokit deploy --target vercel` em T10.1 pode resolver pro `@usetheo/cli` em vez do framework. Demo quebra de forma confusa.
- **Fix sugerido:** Em T8.1, NÃO usar `pnpm exec theokit eval`. Spawn direto via `node node_modules/@usetheo/cli/dist/bin/theokit.js eval ...` OU `pnpm exec @usetheo/cli eval ...` (com `package` namespacing). Adicionar ADR D213 documentando a colisão. Considerar rename do bin do `@usetheo/cli` para `theokit-cli` em uma futura major (fora do escopo desta plan).

### EC-2: Vercel deploy quebra 3 features core (Ollama, MCP, eval-spawn)
- **Task afetada:** T10.1 (Vercel adapter), conflita com T4.1 (Ollama), T6.1 (MCP filesystem), T8.1 (eval spawn)
- **Família:** State / Integration
- **Cenário:** Vercel Functions são serverless stateless. (1) Ollama roda em `localhost:11434` no laptop do dev — Vercel não alcança. Se settings persistido foi `provider: "local"`, todas requests viram `ollama_unreachable`. (2) MCP filesystem usa `child_process.spawn("npx", ["-y", "@modelcontextprotocol/server-filesystem", ...])` — Vercel Functions matam processos não-stdin entre invocações. MCP handshake nunca completa. (3) `theokit eval` em T8.1 também é `child_process.spawn` — mesma quebra.
- **Impacto:** Usuário clica "Deploy to Vercel", deploy completa, abre URL, e 3 das 8 features da demo falham. Promete-se "deploy em um comando" mas entrega-se "chat-only mode em produção".
- **Fix sugerido:** Acrescentar **ADR D214** documentando explicitamente: "Vercel deploy = cloud-only chat + memory + personality + completion/assistant. MCP, Ollama, eval NÃO funcionam em Vercel — esses features são local-dev-only". Adicionar guard no `agent-factory.ts`: se `process.env.VERCEL === "1"`, force `provider: "cloud"` e desabilita MCP + eval routes (HTTP 503 com mensagem). Recomendar Phase 10 mudar D212 para "deploy target: Node self-host (primary), Vercel (chat-only mode)".

### EC-3: Calculator tool com risco de eval injection
- **Task afetada:** T6.1
- **Família:** Permission / Security
- **Cenário:** Plan diz "calculator — Zod `z.object({ expression: z.string() })`, evaluates via safe expression parser (e.g., `mathjs` or hand-rolled)". "Hand-rolled" é a porta de entrada de injection. Se alguém implementa via `new Function(expression)` ou `eval`, qualquer prompt do tipo `calculator({expression: "process.exit(1)"})` derruba o servidor.
- **Impacto:** RCE no servidor de demo. Se demo está deployed publicamente, RCE remoto via prompt do LLM.
- **Fix sugerido:** Travar dep em `expr-eval@^2.0.2` (sandboxed math parser, MIT, sem `eval`, 50KB). Atualizar T6.1 RED `test_calculator_rejects_unsafe_input` para asserir: `calculator({expression: "process.exit(1)"})` retorna `ConfigurationError("invalid_expression")` E `process` ainda está vivo após o test. Banir `eval` e `Function` no biome lint do `server/lib/tools.ts`.

### EC-4: `.theokit/` directory não existe no primeiro `writeSettings`
- **Task afetada:** T2.1
- **Família:** State
- **Cenário:** `settings-store.ts` faz atomic tmp-then-rename para `<cwd>/.theokit/demo-settings.json`. No primeiro run, `<cwd>/.theokit/` pode não existir (especialmente se usuário acabou de clonar — `.theokit/` está no `.gitignore`). `writeFile` lança `ENOENT`.
- **Impacto:** Primeira tentativa de PUT /api/settings → 500. Demo aparece quebrada antes mesmo do dev mandar a primeira mensagem.
- **Fix sugerido:** Em `settings-store.ts`, antes de escrever, `await mkdir(dirname(settingsPath), { recursive: true })`. Adicionar RED test `test_settings_write_creates_dir_when_missing`.

### EC-5: theokit framework version pinning ambiguo
- **Task afetada:** T0.1
- **Família:** Boundary
- **Cenário:** Plan diz "pin via npm semver". `theokit@0.1.0-alpha.5` está publicado mas é **alpha**. `^0.1.0-alpha.5` no pnpm resolve para qualquer `0.1.x` — inclui `0.1.0-alpha.6, 0.1.0-beta.1, 0.1.1`. Alpha bumps podem ser breaking. Primeiro `pnpm install` numa máquina fresca um mês depois pode pegar versão incompatível.
- **Impacto:** Demo construída funciona hoje, quebra silenciosamente quando user clona daqui a 30 dias. Reprodução difícil.
- **Fix sugerido:** Pin EXACTO sem caret: `"theokit": "0.1.0-alpha.5"`. Documentar em README "framework é alpha — não use caret/tilde até `1.0.0`". Considerar `pnpm-workspace.yaml` overrides para travar dependency.

## SHOULD TEST

### EC-6: Concurrent eval runs spawnam múltiplos children
- **Task afetada:** T8.1
- **Teste sugerido:** `test_eval_route_returns_409_when_already_running` — clicar "Run eval" 2x rapidamente; segundo POST deve retornar 409 Conflict com `{ error: "eval_already_running" }`. Manter um `let runningChild: ChildProcess | null = null` no módulo.

### EC-7: SSE buffering por reverse proxy
- **Task afetada:** T3.1, T8.1
- **Teste sugerido:** `test_chat_sse_sets_no_buffering_header` — assert response headers incluem `X-Accel-Buffering: no` e `Cache-Control: no-cache, no-transform`. Sem esses headers, nginx (cenário Vercel/self-host comum) pode buffer o stream inteiro e quebrar UX de streaming.

### EC-8: `Cmd+K` intercepta enquanto user digita
- **Task afetada:** T9.2
- **Teste sugerido:** `test_cmd_k_ignored_when_input_focused` — RTL: focar `<input>`, disparar `Cmd+K`, palette NÃO deve abrir. Guard padrão: `if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;`.

### EC-9: `list_files` retorna lista gigante
- **Task afetada:** T6.1
- **Teste sugerido:** `test_list_files_caps_at_100_entries` — sandbox com 500 arquivos, chamada sem pattern → resposta cap em 100 + flag `truncated: true`. Sem cap, LLM context window estoura ou ToolCallCard renderiza 10MB de JSON.

### EC-10: Cloud auto-detect sem nenhuma env key configurada
- **Task afetada:** T4.1
- **Teste sugerido:** `test_provider_toggle_cloud_without_keys_shows_actionable_error` — usuário em `provider: "cloud"` mas sem `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` no env. Toggle clicado → próxima chamada deve mostrar `<AgentErrorCard>` com mensagem "No cloud provider configured. Set ANTHROPIC_API_KEY or use Ollama (local)". Não 500 silencioso.

### EC-11: User cola 100KB de texto no composer
- **Task afetada:** T3.1
- **Teste sugerido:** `test_chat_rejects_message_above_50k_chars` — POST com `messages[].content.text` > 50000 caracteres retorna 413 Payload Too Large com `{ error: "message_too_long", limit: 50000 }`. Sem cap, agent send falha lá embaixo com erro de token budget, e UX é "tela travou".

### EC-12: First-run banner SSR hydration mismatch
- **Task afetada:** T9.2
- **Teste sugerido:** `test_first_run_banner_no_hydration_mismatch` — SSR não tem `localStorage`, então server renderiza banner como "visível", client com `localStorage.theo_onboarding_dismissed=true` re-renderiza como "oculto" → React warn. Fix: render banner com `useEffect`-gated mount (não no first paint) OU usar cookie em vez de localStorage.

## DOCUMENT

### EC-13: MCP filesystem requer `npx` + rede no primeiro spawn
- **Risco aceito:** Plan já assume dev tem npm. Primeiro `npx -y @modelcontextprotocol/server-filesystem` baixa o pacote. Offline = falha. Aceitável porque dev environment normalmente tem rede. Documentar em README: "first run requires network to bootstrap MCP filesystem; subsequent runs use cache".

### EC-14: HMR pode leakar processos MCP filhos
- **Risco aceito:** Em dev mode, hot-reload pode re-importar `agent-factory.ts` sem terminar a SDK Agent existente. Processos MCP filhos viram orphans até o `pnpm dev` morrer. Não vai pra produção (Vercel não tem HMR; produção mata server entre deploys). Documentar em README dev section: "if you see ghost mcp-server-filesystem processes, run `pkill -f mcp-server-filesystem` between dev restarts".

### EC-15: Memory sidebar faz polling após cada chat completion
- **Risco aceito:** Plan diz "polls /api/memory após cada stream complete". É 1 request HTTP extra por turn. Aceitável pra v1; se demo for hammered (não vai — single-user) trocar por push via SSE no chat stream. Documentar em comment no `memory-sidebar.tsx`: "v1: poll-on-completion. v1.1+: piggy-back na SSE chat stream".

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 2 | 1 (EC-5) | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 1 (EC-4) | 0 | 0 |
| T3.1 | 2 | 0 | 2 (EC-7, EC-11) | 0 |
| T4.1 | 1 | 0 | 1 (EC-10) | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-15) |
| T6.1 | 3 | 1 (EC-3) | 1 (EC-9) | 1 (EC-13, EC-14) |
| T7.1 | 0 | 0 | 0 | 0 |
| T8.1 | 2 | 1 (EC-1) | 1 (EC-6) | 0 |
| T9.1 | 0 | 0 | 0 | 0 |
| T9.2 | 2 | 0 | 2 (EC-8, EC-12) | 0 |
| T10.1 | 1 | 1 (EC-2) | 0 | 0 |
| T11.1 | 0 | 0 | 0 | 0 |
| **TOTAL** | **15** | **5** | **7** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE**

5 MUST FIX precisam ser absorvidos na plan antes de implementação começar:

- **EC-1** (bin collision) e **EC-2** (Vercel breakage) são contradições internas do plan — atrapalham todo o caminho de deploy + eval.
- **EC-3** (calculator injection) é risco de segurança real.
- **EC-4** (mkdir falta) é crash no primeiro run.
- **EC-5** (theokit alpha pin frouxo) garante quebra futura.

SHOULD TEST e DOCUMENT podem entrar como sub-tasks dentro das tasks existentes — não justificam adiar implementação.

## Próximos passos

1. Atualizar `theo-demo-plan.md`:
   - Adicionar ADR **D213** (bin collision resolution: spawn via path absoluto)
   - Adicionar ADR **D214** (Vercel deploy = chat-only mode, com guard `VERCEL=1`)
   - Atualizar T0.1 deps para `"theokit": "0.1.0-alpha.5"` (pin exato)
   - Atualizar T2.1 tasks para incluir `mkdir -p` antes do atomic write
   - Atualizar T6.1 deps para `expr-eval@^2.0.2`, banir `eval`/`new Function` via biome
   - Atualizar T8.1 spawn para `node node_modules/@usetheo/cli/dist/bin/theokit.js`
   - Atualizar T10.1 com guard de runtime quando `VERCEL=1`
2. Adicionar 7 RED tests dos SHOULD TEST nas respectivas tasks.
3. Apresentar plan final ao user.
