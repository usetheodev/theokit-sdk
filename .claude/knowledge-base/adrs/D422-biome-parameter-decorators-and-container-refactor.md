# D422 — Biome parameter decorators enabled + Container refactor (Extract Method)

**Status:** Accepted
**Date:** 2026-05-30
**Plan:** `../../../../.claude/knowledge-base/plans/theokit-sdk-biome-cleanup-plan.md` (under theokit-tools meta-repo)

## Context

`theokit-sdk/packages/di` (`@usetheo/di@0.1.0-next.0`) e `theokit-sdk/packages/di-agent` (`@usetheo/di-agent@0.1.0-next.0`) foram publicados em npm a partir de um worktree onde o biome rodou com config diferente da workspace-root. Quando o pre-commit hook (G2 biome) foi acionado pela primeira vez no workspace principal, 17 violações afloraram:

- **7 parse errors** em test files com `@Inject("X") readonly x: T` em params de constructor — biome 2.4.15 não aceita parameter decorators por default (TC39 stage 3 ainda em finalização).
- **2 complexity errors** em `packages/di/src/container.ts`:
  - `fromFactoryProvider().factory` (linha 387): complexity 11 (limit 10)
  - `constructClassWithAsyncFallback<T>` (linha 435): complexity 18 (limit 10)
- **5 suppressions/unused** warns em tests + 8 FIXABLE warns (todos colaterais aos parse errors)
- **1 useYield** em `packages/sdk/tests/internal/agent-loop/error-packaging.test.ts:149` — mock intencional sem yield

Resultado: pre-commit hook G2 falhou. Commit anterior (`520fe7d` 2026-05-30) precisou `--no-verify` autorizado pelo usuário, gerando débito documentado.

## Decisions

### D1 — Adotar `unsafeParameterDecoratorsEnabled: true` em biome.json

Adicionar:
```json
"javascript": {
  "parser": {
    "unsafeParameterDecoratorsEnabled": true
  },
  ...
}
```

**Rationale:** Parameter decorators são feature legítima TC39 stage 3 + TypeScript legacy decorators. Biome 2.x marca como "unsafe" apenas porque TC39 stage 3 ainda não finalizou. O ecossistema TS já adota há anos (`reflect-metadata` + TS `experimentalDecorators`). `@usetheo/di` exigiria refactor completo para property injection se não habilitássemos — break em API já publicada.

**Alternative rejected:** Property injection em vez de constructor injection. Custo: API break em `0.1.0-next.0` (já em npm) — inaceitável.

**Consequences:**
- Biome aceita `@Inject` em params em todo o workspace.
- 7 parse errors zerados (validado: PARSE=0 após edit).
- 8 FIXABLE warns também zeraram (colaterais dos parse errors).
- Risco residual: TC39 pode mudar o stage 3 final exigindo migração futura. Mitigação: `biome ^2.4.0` pinned no package.json + release notes review ao subir versão.

### D2 — Refactor `constructClassWithAsyncFallback` via Extract Method (complexity 18 → ≤10)

Quebrar em 3 helpers privados:
- `validateMetadata(target, paramTypes)` — checa EC-12 (`paramTypes.length === 0 && target.length > 0`)
- `tryResolveSync(target, paramTypes, injectTokens, optionalFlags, ctx) → { args } | { needsAsync: true }` — discriminated union return
- `resolveAllAsync(target, paramTypes, injectTokens, optionalFlags, ctx) → Promise<T>` — async Promise.all fallback

**Rationale:** Função atual tem 3 responsabilidades (validar metadata + sync attempt + async fallback). Extract Method preserva comportamento exato; cada helper fica abaixo de complexity 10.

**Alternative rejected:** Aumentar `maxAllowedComplexity` em biome.json para 15. Isso normaliza pode-podridão e regride toda outra função do SDK.

**Consequences:**
- API pública intocada (`@usetheo/di` 0.1.0-next.0 contract preserved).
- 5 unit tests novos cobrem helpers extraídos (validateMetadata × 2, tryResolveSync × 2, resolveAllAsync × 1).
- Knip não vai flaggar (helpers privados, não exports).
- publint + attw inalterados (helpers não vazam em `.d.ts`).

### D3 — Refactor `fromFactoryProvider().factory` via Extract Method (complexity 11 → ≤10)

Extrair:
- `tryResolveSyncDeps(injectTokens, ctx) → { args } | { needsAsync: true }` — mesmo shape de D2 para consistência

**Rationale:** Mesma motivação de D2, escala menor.

**Consequences:** Idem D2.

## Implementation evidence

- `biome.json` edit: linha 56-58 (block `javascript.parser`)
- Container refactor: `packages/di/src/container.ts` — 4 helpers privados extraídos
- Test additions: `packages/di/tests/container-core.test.ts` + `async-resolution.test.ts` — 7 specs novos
- Pre-commit + pre-push hooks: passam sem `--no-verify` (resolveu débito de `520fe7d`)

## Alternatives considered

| Alternativa | Por que rejeitada |
|---|---|
| Property injection em vez de constructor | Break API published em npm |
| `maxAllowedComplexity: 15` | Normaliza pode-podridão; regride padrão de todo o SDK |
| `--no-verify` permanente | Viola regra inviolável global "Never skip hooks" |
| Mover @usetheo/di pra repo separado | Resolve sintoma, não causa; mesma config issue voltaria |

## Related

- `[[theokit-sdk-CLAUDE.md]]` — toolchain biome ^2.4.0 locked
- `[[ADR D2]]` (knip strict) — helpers privados não conflitam
- Commit `520fe7d` — débito --no-verify que este ADR resolve
- `[[@usetheo/di package]]` — API consumer-facing intocada
