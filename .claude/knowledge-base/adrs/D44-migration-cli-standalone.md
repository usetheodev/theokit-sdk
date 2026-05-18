# D44 — Migration SQLite → Lance é CLI standalone, NÃO auto-migração

**Status:** Decided
**Date:** 2026-05-17

## Decision

Migração de Memory.index de SQLite para Lance é feita via comando explícito:

```
pnpm exec theokit-migrate-memory [--cwd <path>] [--dry-run] [--keep-sqlite] [--batch-size <n>]
```

Implementação em `packages/sdk/bin/theokit-migrate-memory.mjs` (CLI thin wrapper) + `packages/sdk/src/internal/memory/migrate-sqlite-to-lance.ts` (core logic).

Algoritmo:

1. Abre SQLite index existente em `.theokit/memory/index.sqlite`.
2. Lista todos os facts via `IndexManager.listAll()` (helper).
3. Escreve em Lance em `.theokit/memory/lance-new/` (NUNCA na localização final ainda).
4. Validates round-trip: count match + sample 10 facts com comparação NFC-normalized (EC-3).
5. Se `--dry-run`: print summary + exit 0 (Lance new dir é deletado).
6. Caso contrário: rename `lance-new/` → `lance/`; prompt "Delete sqlite db? (y/N)" via `node:readline/promises` a menos que `--keep-sqlite` setado.

## Rationale

- **Migration destrutiva é cara**: se auto-migrar no primeiro `Memory.open({ backend: "lance" })`, user surpreso pode perder confiança se algo der errado.
- **Explicit opt-in respeita user**: CLI exige intent claro. User pode rodar `--dry-run` primeiro para preview.
- **Atomicidade via rename**: Lance é escrito em diretório temporário `lance-new/`; só vira o canônico após validation success. Crash mid-migration → safe to delete `lance-new/`.
- **SQLite preservada por default**: rollback é "deletar lance/" e voltar a usar SQLite. User pode confirmar a Lance está funcionando antes de remover SQLite.
- **NFC normalization no compare**: Lance e SQLite bindings nativos podem normalizar unicode diferente. Facts em pt-BR/zh/ja com acentos/emojis falham validation se não normalizarmos. EC-3 do edge-case-review.

Alternativas consideradas:

- **Auto-migração na primeira abertura com `backend: "lance"`**: rejeitado — destrutiva sem confirmação.
- **Migration via Memory.migrate() API**: rejeitado — script é mais natural; CLI é o canal certo para operação one-shot.
- **Comparação byte-raw sem normalização**: rejeitado — quebra para users com unicode não-ASCII.
- **Auto-detecção de SQLite no startup quando backend=lance e tentativa de migração-com-prompt**: rejeitado — mistura concerns; CLI é mais limpo.

## Consequences

- `package.json` declara `bin: { "theokit-migrate-memory": "./bin/theokit-migrate-memory.mjs" }`.
- CLI <= 200 LoC (thin wrapper); lógica em `migrate-sqlite-to-lance.ts`.
- Workspace vazio (sem `.theokit/memory/index.sqlite`): exit 0 com mensagem "nothing to migrate" — não é erro (EC-17).
- Workspace com `.theokit/memory/lance/` já existente: erro tipado "destination already exists" + sugestão de `rm -rf .theokit/memory/lance && pnpm exec theokit-migrate-memory ...`.
- Migration de 50k facts em batches de 100 leva ~30s em hardware típico. Documentado em README do feature.
- Lance binding nativo ausente: CLI falha early com mensagem clara sobre instalar `@lancedb/lancedb`.
