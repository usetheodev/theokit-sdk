# Edge Case Review — sdk-v1.1-features-and-validations

Data: 2026-05-17
Tasks analisadas: 12 (T0.1, T1.1, T2.1, T3.1, T3.2, T3.3, T3.1.1, T3.1.S, T4.1, T5.1, T6.1, T7.1, T8.1, T9.1, T10.1)
Edge cases encontrados: 14 (MUST FIX: 2, SHOULD TEST: 6, DOCUMENT: 6)

---

## MUST FIX

### EC-1: Telemetry exporter throw quebra `agent.send`

- **Task afetada:** T2.1
- **Família:** Resource / Permission
- **Cenário:** Consumer plugou OTLP exporter apontando para Jaeger que está offline. A primeira chamada `exporter.export(spans)` lança exception. Sem try/catch, a exception bubbla pelo `agent.send` → todo o run aborta com erro do exporter, NÃO do LLM.
- **Impacto:** Plugar telemetry pode crashar todo o bot. Pior: o erro do exporter parece erro do SDK, levando a horas de debug na direção errada.
- **Fix sugerido:** Em `spans.ts`, todos os `span.end()` e exporter calls devem estar dentro de `try { ... } catch (e) { /* swallow + console.warn once */ }`. Decorator:
  ```ts
  function safe<T>(op: () => T, fallback: T = undefined as T): T {
    try { return op(); } catch (e) { warnOnce("[telemetry] swallowed:", e); return fallback; }
  }
  ```
  Acceptance: `safe()` wrapper em TODA chamada cross-process do OTel (start, end, addEvent, setAttributes, exporter.export).

### EC-2: `streamTheoChat` agent.send rejeita ANTES do stream começar

- **Task afetada:** T3.3
- **Família:** State / Input
- **Cenário:** Cliente envia `POST /api/theochat` com body `{ messages: [] }`. `agent.send("")` (texto vazio) rejeita com `ConfigurationError` antes de qualquer stream começar. Current spec: "mock agent rejects; assert '3:' error line + response 200". MAS: o erro é THROWN sincronamente, então o `Response` body nem foi construído. Resposta vai como HTTP 500 sem corpo → frontend não tem o erro tipado.
- **Impacto:** Erros pre-stream (config inválido, agent not found, auth fail) ficam invisíveis para `useTheoChat` — vê só "HTTP 500" sem detalhe.
- **Fix sugerido:** Em `streamTheoChat`, try/catch ao redor de `agent.send(...)`:
  ```ts
  try { run = await agent.send(...); }
  catch (e) {
    if (e instanceof ConfigurationError) return Response.json({ error: e.message, code: e.code }, { status: 400 });
    return Response.json({ error: "internal" }, { status: 500 });
  }
  // só aqui começa o stream
  ```
  E `useTheoChat` deve checar `response.ok` antes de tentar parsear SSE.

---

## SHOULD TEST

### EC-3: `generateObject` retry leak de transient agents na registry

- **Task afetada:** T1.1
- **Teste sugerido:** `test_generateobject_retry_does_not_leak_registry_entries` — `maxRetries: 2`; mock LLM falha 1x then succeeds. Após call, `Agent.list({ runtime: "local", cwd: tmpdir }).items.length === 0`. Hoje, se cada retry criar agent novo, registry pollui mesmo após dispose.

### EC-4: Span context não propaga em child spans async

- **Task afetada:** T2.1
- **Teste sugerido:** `test_telemetry_child_spans_inherit_trace_context` — span `agent.send` é root; assert que `llm.call` e `tool.call` têm o MESMO `traceId` e `parentSpanId === agent.send.spanId`. Sem isso, OTel viewer mostra spans órfãos.

### EC-5: Spans não fecham se `agent.dispose()` chamado mid-run

- **Task afetada:** T2.1
- **Teste sugerido:** `test_telemetry_open_spans_end_on_dispose` — start agent.send; await 100ms; call dispose() sem aguardar wait(); assert spans foram fechados via `span.end()` (in-memory exporter recebeu finish event). Sem isso, OTel SDK acumula handles em memória.

### EC-6: `useTheoChat` não trata HTTP 4xx/5xx response

- **Task afetada:** T3.2
- **Teste sugerido:** `test_useTheoChat_handles_500_response` — mock fetch returns `Response(JSON, { status: 500 })`. Hook deve setar `error = Error("HTTP 500")` E `isStreaming = false`. Sem isso, hook tenta parsear JSON como SSE e quebra silenciosamente.

### EC-7: `useTheoChat` não limpa AbortController em unmount

- **Task afetada:** T3.2
- **Teste sugerido:** `test_useTheoChat_aborts_on_unmount` — render hook in Testing Library; chama send (mock long stream); unmount o componente mid-stream; assert AbortController.signal.aborted === true. Sem isso, requests pendentes vazam.

### EC-8: SSE stream encerra sem evento `d:` finish (server crash)

- **Task afetada:** T3.2
- **Teste sugerido:** `test_useTheoChat_handles_premature_close` — mock fetch returns SSE stream que envia 1 text delta + close abrupto SEM `d:`. Hook deve setar `isStreaming = false` quando o stream encerra (ReadableStream done = true). Sem isso, UI fica "digitando..." para sempre.

### EC-9: Adversarial safety matrix só testa sandbox ENABLED

- **Task afetada:** T8.1
- **Teste sugerido:** Estender matriz para 20 × {sandbox enabled, sandbox disabled} = 40 outcomes. Documentar separadamente "sandbox-protected" vs "unprotected" results. Sem isso, o claim "20/20 blocked" é só sob configuração específica.

---

## DOCUMENT

### EC-10: `generateObject` provider emite parallel tool calls (Claude 3.5+)

- **Risco aceito:** Plan diz "use first; ignore rest" — para parallel tool use, isso ignora intencionalmente N-1 outputs. Em outputs estruturados isso é OK (o forced tool é "output", LLM não tem razão pra chamar 2x). Documentar no JSDoc: "If the model emits multiple `output` tool calls, only the first is used. This is intentional — the API contract is for single-result generation."

### EC-11: Chaos suite vaza child MCP server processes ao longo de 100 iterações

- **Risco aceito:** Cada victim.mjs spawn MCP filesystem → kill -9 mata victim mas órfana o filho MCP. Após 100 iters, ~100 processes zumbis em background. Mitigação: documentar limpeza manual (`pkill -f modelcontextprotocol-server-filesystem`) entre runs OR adicionar trap no script. Documentar nos READMEs que o chaos suite deve ser rodado em ambiente dedicado.

### EC-12: Memory recall hit-rate measured on synthetic facts (artificial baseline)

- **Risco aceito:** 50 facts sintéticos podem ser construídos pra ter recall artificialmente alto (e.g., 10 facts sobre programming languages, query = "qual linguagem?"). Documentar no rubric: "Hit-rate measured on representative semantic spread — varied topics, paraphrasing, near-duplicates. Number is a v1.1 baseline, not absolute benchmark."

### EC-13: Telegram-pro `/fact` não tem fallback se `generateObject` falhar

- **Risco aceito:** Se LLM não responde ou Zod parse falha após retries, `/fact` retorna erro ao usuário. Documentar no handler: graceful fallback para plain `Remember:` write quando `generateObject` lança. 3 linhas de try/catch no T3.1.S handler.

### EC-14: `@usetheo/sdk` + `@usetheo/react` version coupling não definido

- **Risco aceito:** Se consumer instala `@usetheo/sdk@1.1` + `@usetheo/react@1.0` (versão antiga), wire format pode estar dessincronizado. Documentar no `packages/react/package.json`: `"peerDependencies": { "@usetheo/sdk": "^1.1.0" }` (não `workspace:*` no published). Plan menciona `workspace:*` que é só dev; release precisa pin range explícito.

### EC-15: Vercel AI Data Stream v1 spec não está pinado a versão fonte

- **Risco aceito:** Hoje (Vercel AI v4) o protocolo é estável, mas eles podem renomear códigos (`0:` → `text:`). Documentar no D38: "Spec inlined em `packages/react/src/wire-format.md` com fingerprint dos códigos atuais. Upgrade do Vercel AI requer revalidação do protocolo."

### EC-16: `includeContent: true` em telemetry pode logar chaves de API se usuário colar em prompt

- **Risco aceito:** `Remember: my API key is sk-ant-...` → spans logam content → tracing system tem secret. Mitigação: documentar JSDoc claramente "includeContent: true exposes user-supplied content to your tracing backend. Sanitize prompts or use redact pattern on your exporter."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (ADRs) | 0 | 0 | 0 | 0 |
| T1.1 (generateObject) | 2 | 0 | 1 (EC-3) | 1 (EC-10) |
| T2.1 (telemetry) | 4 | 1 (EC-1) | 2 (EC-4, EC-5) | 1 (EC-16) |
| T3.1 (react pkg) | 0 | 0 | 0 | 0 |
| T3.2 (useTheoChat) | 3 | 0 | 3 (EC-6, EC-7, EC-8) | 0 |
| T3.3 (streamTheoChat) | 1 | 1 (EC-2) | 0 | 0 |
| T3.1.S (telegram-pro showcase) | 1 | 0 | 0 | 1 (EC-13) |
| T4.1 (chaos) | 1 | 0 | 0 | 1 (EC-11) |
| T5.1 (MCP) | 0 | 0 | 0 | 0 |
| T6.1 (memory scale) | 1 | 0 | 0 | 1 (EC-12) |
| T7.1 (CLI-bot) | 0 | 0 | 0 | 0 |
| T8.1 (adversarial) | 1 | 0 | 1 (EC-9) | 0 |
| Cross-cutting | 2 | 0 | 0 | 2 (EC-14, EC-15) |

**Veredicto: PLANO PRECISA DE PEQUENO AJUSTE**

**Justificativa:** 2 MUST FIX são realistas e baratos:
- **EC-1** (telemetry exporter throw): sem `safe()` wrapper, telemetry pode crashar agent.send em prod. Fix é 1 decorator + uso consistente. Custo: ~5 min.
- **EC-2** (streamTheoChat pre-stream error): sem try/catch HTTP, frontend não vê erros tipados. Fix é 3 linhas. Custo: ~5 min.

Os 6 SHOULD TEST são adições aos TDDs respectivos (sem mudar design). Os 6 DOCUMENT são caveats que viram comentários JSDoc ou notas no README.

**Ação:**
1. Incorporar EC-1 ao T2.1 deep-dives + acceptance criteria
2. Incorporar EC-2 ao T3.3 deep-dives
3. Adicionar 6 testes RED nos TDDs de T1.1, T2.1, T3.2, T8.1
4. EC-10 a EC-16: 1-linha de doc em cada task ou na seção "Riscos e Mitigações"
