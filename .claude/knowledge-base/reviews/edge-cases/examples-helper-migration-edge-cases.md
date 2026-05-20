# Edge Case Review — examples-helper-migration

Data: 2026-05-17
Tasks analisadas: 9 (T0.1, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1, T5.1-3)
Edge cases encontrados: 6 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 3)

---

## MUST FIX

### EC-1: `pnpm install --ignore-workspace` mantém lock antigo e não refresh do dist do SDK

- **Task afetada:** T1.1 (typecheck-sweep)
- **Família:** State / Resource
- **Cenário:** Cada example tem seu próprio `pnpm-lock.yaml` que pinou o SDK no estado anterior ao rebuild. Quando o sweep roda `pnpm install --ignore-workspace`, pnpm prefere o lock existente — o symlink para o `dist/` do SDK NÃO é refrescado mesmo após `pnpm --filter=@usetheo/sdk run build`. Resultado: `tsc --noEmit` vê a API antiga, falha com erros que parecem "regressão SDK" mas são lock obsoleto. Já vimos esse efeito durante a migração do telegram-pro nesta sessão.
- **Impacto:** Sweep reporta dezenas de falsos positivos. Triagem manual de cada fail consome ~1h; pior, mascara regressões REAIS.
- **Fix sugerido:** No script `tools/typecheck-examples.sh`, usar `pnpm install --ignore-workspace --no-frozen-lockfile` (ou rm `pnpm-lock.yaml` antes do install em cada example). Adicionar como linha explícita:
  ```bash
  (cd "$ex" && pnpm install --ignore-workspace --no-frozen-lockfile --silent > /dev/null 2>&1)
  ```

---

## SHOULD TEST

### EC-2: Fail triage (T1.2) não diferencia "tsc error" de "runtime/env error"

- **Task afetada:** T1.2
- **Teste sugerido:** `test_typecheck_sweep_classifies_error_kind` — rodar o sweep com 1 example que tem `tsc` error real + 1 example que falha por env-var missing (e.g., process.env.X.length sem X). Assert que o snapshot diferencia "tsc-error" vs "runtime-only" para que o operador humano não trate ambos igual. Sem isso, examples que requerem `.env` real (telegram-bot etc.) sobem como "fail" mesmo com typecheck verdinho — confunde a baseline.
- **Fix mínimo:** No script T1.1, separar o boot smoke do typecheck — typecheck SEMPRE roda; boot smoke só nos examples que têm `theo_test_*` fixture key (não requer rede). Marcar examples com env-real-required como `boot-skip` na coluna.

### EC-3: `pnpm dev --builder` flag-parsing pode quebrar dependendo de como pnpm passa argv

- **Task afetada:** T3.1
- **Teste sugerido:** `test_quickstart_flag_dispatch_via_pnpm` — verificar manualmente que **AMBOS** os comandos funcionam:
  - `pnpm dev` → roda `main()` (options-bag)
  - `pnpm dev -- --builder` → roda `mainWithBuilder()` (pnpm usa `--` para forward de argv)
- **Fix mínimo:** Documentar no README do quickstart o comando EXATO (`pnpm dev -- --builder`). Alternativa mais robusta: usar env var `BUILDER=1 pnpm dev` em vez de argv — env var é unambiguous através de tsx/pnpm/etc.

---

## DOCUMENT

### EC-4: Sweep paralelizado contende registry npm

- **Risco aceito:** Se o script usar `xargs -P 8` (sugerido nos Riscos do plano), 8 `pnpm install` simultâneos podem contender o registry (mirror local ou network). pnpm v9 tem locking interno por store global — concurrent instalations geralmente cooperam, mas em registry lento (firewall corporativo, mirror saturado) pode haver `EAGAIN`. Aceito porque: (1) o sweep é manual/CI, não hot path; (2) `xargs -P 4` é fallback simples; (3) re-run is idempotent.

### EC-5: README index dos 39 examples diverge silenciosamente da realidade

- **Risco aceito:** A tabela em `examples/README.md` é manual. Se alguém adicionar example sem atualizar a tabela, ou migrar example sem atualizar a coluna "Helper used", o leitor vê info errada. **Mitigação documentada no plano** (linha "Adicionar nota apontando para tools/triage-examples.sh para regenerar"). Geração 100% automática do README seria over-engineering — uma nota humana basta.

### EC-6: Bot polling collision quando T5.3 dispara `pnpm dev` no telegram-pro

- **Risco aceito:** Se outra instância do bot ainda estiver rodando (do plano anterior, ou crash recovery), o grammy polling vence + perde 409 conflict. Já vimos esse padrão no Phase 7 do plano predecessor. **Já endereçado em T5.3** ("Execution" inclui `pkill -9 -f telegram-pro/src/index`). Sem mudança necessária — só confirmar que o operador siga o passo 1.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (triage script) | 0 | 0 | 0 | 0 |
| T1.1 (typecheck-sweep) | 2 | 1 (EC-1) | 0 | 1 (EC-4) |
| T1.2 (fail triage) | 1 | 0 | 1 (EC-2) | 0 |
| T2.1 (dogfood migration) | 0 | 0 | 0 | 0 |
| T2.2 (shell-tool) | 0 | 0 | 0 | 0 |
| T2.3 (hooks-policy) | 0 | 0 | 0 | 0 |
| T3.1 (quickstart showcase) | 1 | 0 | 1 (EC-3) | 0 |
| T4.1 (README index) | 1 | 0 | 0 | 1 (EC-5) |
| T5.1-3 (cross-validation) | 1 | 0 | 0 | 1 (EC-6) |

**Veredicto: PLANO PRECISA DE PEQUENO AJUSTE**

**Justificativa:** EC-1 é um MUST FIX claro — vimos o efeito durante a migração anterior. Sem `--no-frozen-lockfile` (ou equivalente), o sweep T1.1 emitirá fail rate alto e o operador vai gastar tempo triaging falsos positivos. Fix é 1 flag adicional no comando — custo trivial. EC-2 e EC-3 são SHOULD TEST — sem eles a baseline T1.1 contamina e a quickstart showcase pode silenciosamente falhar. EC-4/5/6 são riscos aceitos e já documentados no plano original (Riscos table).

**Ação:** Incorporar EC-1 ao T1.1 como flag obrigatória no script + EC-2 ao T1.2 como separação tsc/boot + EC-3 ao T3.1 como nota explícita no README do quickstart. Os 3 DOCUMENT ficam como caveats no plano (já cobertos).
