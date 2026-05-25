# Edge Case Review — production-readiness

Data: 2026-05-25
Tasks analisadas: 24 (T0.1 → T7.4)
Edge cases encontrados: 17 (MUST FIX: 6, SHOULD TEST: 6, DOCUMENT: 5)

## MUST FIX

### EC-1: `FileSystemConversationStorage.deleteConversation` precisa path-guard explícito
- **Task afetada:** T1.3
- **Família:** Permission / Path traversal
- **Cenário:** O método `deleteConversation` é NOVO no plano. `sessionFilePath()` aplica `sanitizeIdentifier` + `safePathJoin`, mas `deleteConversation` foi descrito como `rm({ recursive: true, force: true })` direto. Se `conversationId = "../../../tmp"` chega via API pública (TheoKit route handler), o path escape NÃO É detectado.
- **Impacto:** Apaga arquivos fora do `.theokit/agents/`. Security hole.
- **Fix sugerido:** No corpo do `deleteConversation`, chamar `const safeId = sanitizeIdentifier(conversationId, { maxLen: 128 }); const dirPath = safePathJoin(this.root, ".theokit", "agents", safeId);` e só então `rm(dirPath, { recursive: true, force: true })`. **1 linha** adicionada na implementação + nota no plano em T1.3 Deep Dives.

### EC-2: `listConversationIds` falha com ENOENT em first run
- **Task afetada:** T1.3
- **Família:** Resource / I/O
- **Cenário:** `readdir(<root>/.theokit/agents/)` em projeto novo (dir não existe ainda) lança `ENOENT`. Cair direto pra produção (ex: nuevo Vercel deploy) quebra.
- **Impacto:** Crash no primeiro `Agent.registry.evictAll()` SIGTERM handler antes do primeiro append.
- **Fix sugerido:** `try { await readdir(...) } catch (e) { if (e.code === "ENOENT") return []; throw; }`. **3 linhas**. Já é o pattern em `readSessionFile`.

### EC-3: Resume sem `conversationStorage` faz silent fallback FS mesmo quando agent foi criado com Postgres
- **Task afetada:** T1.5
- **Família:** State / Data loss
- **Cenário:** Caller criou agent com `conversationStorage: postgresAdapter`. Postgres persistiu turns. Processo restart. Resume sem passar storage de novo → plano diz "stderr warn + fallback FS adapter". FS adapter lê `.theokit/agents/<id>/messages.jsonl` que não existe → retorna `[]`. **Conversation perdeu o histórico** silenciosamente. Caller acha que está funcionando.
- **Impacto:** Data corruption observável. Pior: o próximo `appendMessage` agora escreve em FS, fragmentando a fonte da verdade.
- **Fix sugerido:** Persistir marker `requiresCustomStorage: true` no registry.json snapshot quando `options.conversationStorage` foi non-undefined no create. No resume sem storage E marker presente → throw `ConfigurationError(code: "conversation_storage_required", message: "Agent <id> was created with a custom conversationStorage adapter; pass it again on resume.")`. Stronger fail beats silent corruption. **5 linhas** no registry-store + 5 linhas no resume path.

### EC-4: `LiveAgentRegistry.set(id, agent)` quando ID já existe vaza o agent anterior
- **Task afetada:** T2.1
- **Família:** Resource / Memory leak
- **Cenário:** Duas calls `Agent.getOrCreate("user-42")` em sequência rápida (race entre 2 requests para o mesmo user). Primeira termina, set no cache. Segunda termina, set no cache — overwrite SEM dispose do primeiro. O primeiro agent fica com `#lifecycleAbortController`, file handles, e o LiveAgentRegistry perde referência mas o objeto continua reachable via outras closures (in-flight stream readers).
- **Impacto:** Memory leak gradual em servidor multi-request. Exatamente o que Phase 2 está tentando resolver — vira a fonte do próprio problema.
- **Fix sugerido:** Em `set(id, agent)`: `const existing = this.#agents.get(id); if (existing !== undefined && existing.agent !== agent) { void existing.agent.dispose().catch(() => {}); }` antes do `this.#agents.set(id, ...)`. Idempotent quando agent é o mesmo (`existing.agent === agent`). **3 linhas**.

### EC-5: `AbortSignal.any` não disponível em todos os runtimes alvos
- **Task afetada:** T4.2
- **Família:** Boundary / Runtime compat
- **Cenário:** Plano usa `AbortSignal.any([userSignal, lifecycleSignal])`. Node 22 (D1) OK. Cloudflare Workers OK (suporte 2024). **Vercel Edge runtime ainda usa subset que pode não ter** (depende da release; histórico mostrou que features novas de WHATWG demoram). Se a infra do consumer roda em runtime sem `AbortSignal.any`, **runtime crash no primeiro `send()`**.
- **Impacto:** Quebra exatamente o caso de uso Vercel/CF que o plano promete destravar.
- **Fix sugerido:** Feature-detect com ponyfill:
  ```ts
  function anySignal(signals: AbortSignal[]): AbortSignal {
    if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
    const ctrl = new AbortController();
    for (const s of signals) {
      if (s.aborted) { ctrl.abort(s.reason); break; }
      s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
    }
    return ctrl.signal;
  }
  ```
  Helper em `internal/runtime/abort-utils.ts`. **~10 linhas**. Adicionar ADR D324 documenting decision.

### EC-6: `onToolStart` fires antes do `validate`; se validate falha, hook fica "start sem end"
- **Task afetada:** T5.3
- **Família:** State / Pair invariant
- **Cenário:** Plano descreve a sequência: emit `onToolStart` → `dispatchToolWithRepair` → emit `onToolEnd` ou `onToolError`. Mas dentro do `dispatchToolWithRepair`: se `validate.value.ok === false`, retorna `DispatchResult { isError: true, content: "Invalid arguments..." }` SEM jamais chamar o handler. No wrap atual do plano, `onToolError` fires (isError = true). **OK**. Mas o handoff define `onToolError({ error: Error })` — o content é uma string ("Invalid arguments for..."), não Error. **Tipo mismatch silencioso.**
- **Impacto:** Listeners que fazem `event.error.stack` quebram com `Cannot read property of undefined`.
- **Fix sugerido:** No wrap: `if (result.isError) { onToolError?.({ ..., error: new Error(result.content), ... }) }`. Garante `Error` real. Plano já MENCIONA `new Error(result.content)` na seção Deep Dives de T5.3 — **promote to explicit acceptance criterion** + test: `test_onToolError_receives_Error_instance_not_string`.

## SHOULD TEST

### EC-7: `LiveAgentRegistry.get(id)` durante eviction async em vôo
- **Task afetada:** T2.2
- **Cenário:** `set(id_new)` excede cap → trigger `#evictLRU` que faz `map.delete(id_old)` sync + `agent.dispose()` async. Entre o `map.delete` e o end do dispose, `get(id_old)` retorna `undefined` (consistente). Mas se outro caller já tinha `const cached = registry.get(id_old)` BEFORE eviction, ele segura a referência viva e usa um agent meio-disposed.
- **Teste sugerido:** `test_get_during_eviction_returns_undefined_or_disposing` — assert `agent.dispose()` foi chamado antes de novos calls hit "no entry" status. Plus: docs.md deve dizer "agent returned by `Agent.registry.get` may be disposed concurrently; use `getOrCreate` for in-flight safety."

### EC-8: Idle sweep concorrente com `set` do mesmo id
- **Task afetada:** T2.3
- **Cenário:** Sweep encontra `id_X` idle, starts `await dispose()`. Durante o await, `set(id_X, new_agent)` chega. Map agora tem `new_agent`. Old dispose completes — old agent gone. **New agent OK, no corruption.** Mas se sweep tivesse cached o `entry` (não reload `map.get` after await), poderia chamar `map.delete(id_X)` matando o new agent.
- **Teste sugerido:** `test_sweep_does_not_delete_replaced_entry` — sweep deve `map.get(id)` re-check após await dispose, ou usar entry-identity check (`map.get(id) === originalEntry`) antes de delete.

### EC-9: Tool handler em vôo durante user-abort
- **Task afetada:** T4.4
- **Cenário:** Custom tool com handler async (e.g., DB query 5s). User aborts mid-stream. Stream + provider call canceladas. Tool handler continua rodando (não recebe signal — D318 escope é só o LLM fetch). Quando tool retorna, dispatch tenta feed result no run que já está em estado `aborted`.
- **Teste sugerido:** `test_tool_handler_completes_after_abort_result_discarded` — assert: tool's side effects (DB write) acontecem, mas dispatch.feedToolResult não throws e não persiste. Documentar em docs.md: "Custom tool handlers ainda completam após abort; para cancellation-aware handlers, accept `signal` em sua own opts."

### EC-10: `StoredMessage` com role não-persistible em FS adapter
- **Task afetada:** T1.3
- **Cenário:** Interface `StoredMessage` aceita `role: "user" | "assistant" | "system" | "tool_call" | "tool_result"`. FS adapter hoje só persiste user/assistant em JSONL (`PersistedSessionMessage`). Se caller chama `adapter.appendMessage(id, { role: "tool_call", content: "..." })`, hoje seria silenciosamente skip ou crash dependendo de implementação.
- **Teste sugerido:** `test_fs_adapter_appendMessage_with_tool_call_role` — decisão e teste: assert que (a) FS adapter persiste todos os 5 roles (expand `PersistedSessionMessage.role` type), OU (b) FS adapter rejeita explicitly com error "unsupported role for FS adapter — use a richer adapter for tool messages". Plano deve escolher e o teste pinar. **Recomendo (a)** porque é forward-compat.

### EC-11: `retryAfterMs` com `retryAfter: 0`
- **Task afetada:** T3.2
- **Cenário:** Provider envia `Retry-After: 0` (rare but legal). Mapper gravas `metadata.retryAfter: 0`. Getter `retryAfterMs` retorna `0` (não undefined) — semanticamente OK (`setTimeout(0)` é válido), mas caller que checa `if (err.retryAfterMs)` (falsy check) trata como "no hint".
- **Teste sugerido:** `test_retryAfterMs_returns_zero_when_metadata_retryAfter_is_zero` — assert `=== 0`, não `undefined`. Documentar em docs/error-codes.md: "Use `!== undefined` check, not truthy check, for retryAfterMs."

### EC-12: `onBeforeSend.messageCount` definição ambígua
- **Task afetada:** T6.3
- **Cenário:** Plano diz `messageCount = currentSessionMessages.length`. Mas isso é (a) "messages persisted ANTES do que essa send vai adicionar" — claro — ou (b) "incluindo essa pending"? Caller que limita "max 50 messages per conversation" precisa saber: se messageCount = 50 é "50 já salvos, esse seria o 51º" ou "50 incluindo esse"?
- **Teste sugerido:** `test_onBeforeSend_messageCount_excludes_pending` — assert que hook fires ANTES do user message ser appended, então count reflete persisted state. Plus: assinatura do hook deve renomear pra clareza: `previousMessageCount` ou `existingMessageCount`. **Sem custo runtime.**

## DOCUMENT

### EC-13: Eviction triggers dispose triggers abort em send em vôo — UX confusion
- **Risco aceito:** `Agent.registry.evict(id)` durante `agent.send()` em vôo causa `AgentRunError({ code: "aborted" })`. Caller não sabe se foi user-abort vs lifecycle-abort vs SIGTERM-abort. Para v1, todos viram code "aborted". Mitigation: `error.cause` carrega o `DOMException` original com reason — caller pode inspect se precisar. v2 pode adicionar `subCode` ou `reason` field. Documentar em docs.md.

### EC-14: T7.2 cross-repo TheoKit smoke é blocking external
- **Risco aceito:** Phase 7 T7.2 depende de TheoKit team coordenar bump + write fixture + run smoke. Fora do controle do SDK team. Solução: SDK team publishes `next.N` tag → notifies TheoKit via cross-repo handoff doc → TheoKit team has 1-week SLA para report green/red. Se TheoKit team unresponsive, SDK team publishes anyway com nota "cross-repo smoke pending" no CHANGELOG.

### EC-15: Provider error mappers usam string matching (fragile)
- **Risco aceito:** OpenAI 400 + "model not found" → `invalid_model` via substring match `error.message.toLowerCase().includes("model")`. Quando OpenAI muda copy (raramente, mas acontece — viu em 2025 com Anthropic), mapper devolve `invalid_request` ou `unknown`. Mitigation: unknown é safe fallback; caller branches em `code === "invalid_request"` continua funcionando. Adicionar test snapshot bi-anual contra OpenAI real responses (deferir pra Phase 7).

### EC-16: `durationMs` pode ser 0 para handlers muito rápidos
- **Risco aceito:** `Date.now()` resolution 1ms. Handler que retorna sync `() => "ok"` → start e end no mesmo ms tick → durationMs = 0. Caller que computa "events per second" via 1/durationMs pega divisão por zero. Documentar: "Use `Math.max(durationMs, 1)` quando computando rates. Para sub-ms precision, use `performance.now()`-based custom hooks (caller responsibility)."

### EC-17: `attempt` field sempre `1` em v1 (no tool retry)
- **Risco aceito:** Handoff define `onToolError.event.attempt: number  // 1-indexed retry count (1 = first try)`. SDK não retry tools hoje. Manter field para forward compat — sempre `1` em v1. Documentar: "Reserved for v2 tool retry policy. Always 1 in v1."

---

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 3 | 2 (EC-1, EC-2) | 1 (EC-10) | 0 |
| T1.4 | 0 | 0 | 0 | 0 |
| T1.5 | 1 | 1 (EC-3) | 0 | 0 |
| T1.6 | 0 | 0 | 0 | 0 |
| T1.7 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 1 (EC-4) | 0 | 0 |
| T2.2 | 1 | 0 | 1 (EC-7) | 0 |
| T2.3 | 1 | 0 | 1 (EC-8) | 0 |
| T2.4 | 1 | 0 | 0 | 1 (EC-13) |
| T2.5 | 0 | 0 | 0 | 0 |
| T2.6 | 0 | 0 | 0 | 0 |
| T2.7 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-11) | 0 |
| T3.3 | 1 | 0 | 0 | 1 (EC-15) |
| T3.4 | 0 | 0 | 0 | 0 |
| T3.5 | 0 | 0 | 0 | 0 |
| T3.6 | 0 | 0 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| T4.2 | 1 | 1 (EC-5) | 0 | 0 |
| T4.3 | 0 | 0 | 0 | 0 |
| T4.4 | 1 | 0 | 1 (EC-9) | 0 |
| T4.5 | 0 | 0 | 0 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 0 | 0 | 0 | 0 |
| T5.3 | 3 | 1 (EC-6) | 0 | 2 (EC-16, EC-17) |
| T5.4 | 0 | 0 | 0 | 0 |
| T6.1 | 0 | 0 | 0 | 0 |
| T6.2 | 0 | 0 | 0 | 0 |
| T6.3 | 1 | 0 | 1 (EC-12) | 0 |
| T6.4 | 0 | 0 | 0 | 0 |
| T7.1 | 0 | 0 | 0 | 0 |
| T7.2 | 1 | 0 | 0 | 1 (EC-14) |
| T7.3 | 0 | 0 | 0 | 0 |
| T7.4 | 0 | 0 | 0 | 0 |
| **TOTAIS** | **17** | **6** | **6** | **5** |

**Veredicto:** **PLANO PRECISA DE AJUSTE** — 6 MUST FIX devem ser absorvidos no plano antes de iniciar implementação.

### Absorção recomendada (changelog do plano)

Editar `production-readiness-plan.md`:

1. **T1.3 Deep Dives** — adicionar EC-1 (path-guard em deleteConversation) + EC-2 (ENOENT catch em listConversationIds).
2. **T1.5 Deep Dives** — adicionar EC-3 (`requiresCustomStorage` marker no registry + throw on resume mismatch). Adicionar ADR D325 nova.
3. **T2.1 Deep Dives + Tasks** — adicionar EC-4 (dispose old entry on overwrite em `set`).
4. **T4.2 Tasks** — adicionar EC-5 (`anySignal` ponyfill helper em `internal/runtime/abort-utils.ts`). Adicionar ADR D324.
5. **T5.3 Acceptance Criteria** — adicionar EC-6 explicit (test `test_onToolError_receives_Error_instance_not_string`).
6. **T1.3 SHOULD TEST** — adicionar EC-10 (decisão sobre `StoredMessage` roles não-persistible — recomendado: expandir `PersistedSessionMessage.role`).

Após absorção, plano pronto para implementação.
