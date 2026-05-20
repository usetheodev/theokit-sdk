# Edge Case Review — sdk-v1.2-parity-with-vercel-ai

Data: 2026-05-17
Tasks analisadas: 12 (T0.1 → T6.3)
Edge cases encontrados: 18 (**MUST FIX: 3**, SHOULD TEST: 9, DOCUMENT: 6)

## MUST FIX (incorporados ao plano)

### EC-1: SQL injection em filtro de namespace/scope no LanceIndex
- **Task afetada:** T5.1
- **Família:** Permission / Input
- **Cenário:** Plan original mostrava `.where(\`namespace = '${opts.namespace}'\`)` com nota "parameterized in real impl". String interpolation permite atacante com controle sobre `userId`/namespace ler facts de outros users.
- **Impacto:** Cross-user data leak via Memory.search. Quebra invariante de namespace isolation.
- **Fix aplicado:** Deep Dive de T5.1 atualizado com `.where({ namespace: opts.namespace })` (Lance structured filter). Teste obrigatório `test_lance_namespace_filter_rejects_injection_attempt` adicionado ao TDD.

### EC-2: OAuth `state` parameter gerado mas não validado no callback
- **Task afetada:** T3.1
- **Família:** Permission
- **Cenário:** Plan original mostrava `&state=<random>` na auth URL mas algoritmo não validava no callback. Localhost callback aceita qualquer GET → site malicioso pode disparar `fetch("http://localhost:<port>/?code=attacker_code")` e SDK aceita.
- **Impacto:** Account takeover via OAuth CSRF.
- **Fix aplicado:** PKCE flow step 6 explicita "VALIDATE returned state === generated state. If mismatch → throw OAuthStateMismatchError." Teste `test_oauth_localhost_callback_rejects_mismatched_state` adicionado.

### EC-3: Round-trip validation de migração usa string equality sem normalização
- **Task afetada:** T5.2
- **Família:** Format
- **Cenário:** Plan dizia "sample 10: text + namespace match". SQLite/Lance bindings nativos podem normalizar unicode diferente (NFC vs NFD) → facts com acentos/emojis falham validation.
- **Impacto:** Users com facts em pt-BR/zh/ja BLOQUEADOS de migrar.
- **Fix aplicado:** Step 5 atualizado para `text.normalize("NFC")` em ambos os lados. Teste `test_migration_validation_handles_unicode_normalization` adicionado.

## SHOULD TEST (incorporados ao TDD)

| EC | Task | Test |
|----|------|------|
| EC-4 | T1.1 | `test_streamobject_iter_return_disposes_transient_agent` |
| EC-5 | T1.1 | `test_streamobject_with_refined_schema_falls_back_to_complete_only` |
| EC-6 | T1.1 | `test_streamobject_ignores_duplicate_output_tool_calls` |
| EC-7 | T2.1 | `test_useTheoCompletion_concurrent_complete_calls_cancels_first` |
| EC-8 | T5.1 | `test_lance_open_with_dimension_mismatch_throws_typed_error` |
| EC-9 | T3.1 | `test_token_refresh_is_serialized_per_server` |
| EC-10 | T3.1 | `test_token_storage_defaults_expires_in_to_3600s_when_missing` |
| EC-11 | T2.2 | `test_sse_parser_ignores_unknown_codes` |
| EC-12 | T4.1 | `test_auto_instrumentation_skips_when_provider_already_has_langfuse_processor` |

## DOCUMENT (incorporados à seção Notas)

| EC | Risco aceito |
|----|--------------|
| EC-13 | `streamObject` batched models = zero partials. Docs aviso. |
| EC-14 | Windows sem keytar = tokens plaintext em disco. ADR D41 + README aviso. |
| EC-15 | Authorization endpoints sem PKCE não suportados em v1.2. Erro tipado. |
| EC-16 | LanceDB binding falha em Alpine/musl/ARM. README aviso, SQLite default. |
| EC-17 | Migration CLI em workspace vazio = "nothing to migrate" + exit 0. |
| EC-18 | useTheoAssistant: schema diverge → partial falha silenciosa, complete válido. |

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 3 | 0 | 3 | 1 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 | 0 |
| T2.2 | 2 | 0 | 1 | 1 |
| T3.1 | 5 | 1 | 2 | 2 |
| T3.2 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 1 | 0 |
| T5.1 | 2 | 1 | 1 | 1 |
| T5.2 | 2 | 1 | 0 | 1 |
| T6.1-6.3 | 0 | 0 | 0 | 0 |

**Veredicto:** PLANO PRECISA DE AJUSTE (após patches) → **PLANO OK**.

Os 3 MUST FIX foram incorporados em-place no plano (sql injection → structured filter; OAuth state → validation step; unicode normalization → NFC compare). Os 9 SHOULD TEST viraram entries adicionais nos TDD blocks dos tasks afetados. Os 6 DOCUMENT foram listados na seção "Notas / Edge cases DOCUMENT" do plano.

Plano está pronto para implementação.
