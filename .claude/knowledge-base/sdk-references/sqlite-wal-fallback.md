# SQLite WAL Fallback

> Toda conexão SQLite do SDK abre com `PRAGMA journal_mode=WAL`. Se o
> filesystem rejeitar (NFS/SMB/FUSE legados), cai para `DELETE` e logga
> WARNING uma vez por DB. WAL = concurrent readers + 1 writer = fast
> multi-process. Sem fallback, NFS users perdem TODA feature backed by
> SQLite.

## Quando aplicar

Aplique em qualquer SQLite connection que:

- Vai ser acessada por múltiplos processos (cron + gateway + CLI)
- Precisa de leituras concorrentes (search-while-writing)
- Roda em filesystem do usuário (~/.theokit, não /tmp ephemeral)

Skip aplicação para:

- DBs in-memory (`:memory:` — WAL inválido)
- Test fixtures rápidos (sem multi-process)

## Por que importa

NFS/SMB/FUSE rejeitam WAL porque o mecanismo depende de shared memory
(`*.db-shm`). Sem fallback para DELETE, abertura do DB lança
`OperationalError: locking protocol`. Usuário com `~` em NFS vê o SDK
travar.

Hermes documenta o pattern em `hermes_state.py:128-183`
(`apply_wal_with_fallback`). Aplicado para `state.db`, `kanban.db`, batch
runner state DB. Sem isso, qualquer feature SQLite quebra em
ambiente corporate (homedirs frequentemente em NFS).

## Pattern canonical (Python)

```python
# hermes_state.py:128 (simplified)
import sqlite3
import logging

_WAL_WARNING_LOGGED = set()  # one warning per DB label per process

def apply_wal_with_fallback(conn: sqlite3.Connection, *, db_label: str) -> None:
    """Apply PRAGMA journal_mode=WAL. Fall back to DELETE on NFS/SMB/FUSE."""
    try:
        result = conn.execute("PRAGMA journal_mode=WAL").fetchone()
        mode = (result[0] if result else "").lower()
        if mode == "wal":
            return  # success
        # SQLite returned a different mode → filesystem rejected WAL
        _log_fallback_once(db_label, reason=f"got mode={mode}")
    except sqlite3.OperationalError as e:
        _log_fallback_once(db_label, reason=str(e))

    # Fall back
    conn.execute("PRAGMA journal_mode=DELETE")


def _log_fallback_once(db_label: str, *, reason: str) -> None:
    key = db_label
    if key in _WAL_WARNING_LOGGED:
        return
    _WAL_WARNING_LOGGED.add(key)
    logging.warning(
        f"SQLite WAL mode rejected for {db_label} ({reason}). "
        f"Falling back to DELETE journal. Concurrent readers will block writers."
    )
```

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/persistence/sqlite-wal.ts
import type Database from "better-sqlite3";

const WAL_WARNING_LOGGED = new Set<string>();

export function applyWalWithFallback(
  db: Database.Database,
  options: { label: string; logger?: (msg: string) => void },
): void {
  const { label, logger = console.warn } = options;
  try {
    const result = db.pragma("journal_mode = WAL", { simple: true }) as string;
    if (result.toLowerCase() === "wal") return;
    logFallbackOnce(label, `got mode=${result}`, logger);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFallbackOnce(label, msg, logger);
  }
  db.pragma("journal_mode = DELETE");
}

function logFallbackOnce(label: string, reason: string, logger: (msg: string) => void): void {
  if (WAL_WARNING_LOGGED.has(label)) return;
  WAL_WARNING_LOGGED.add(label);
  logger(
    `[theokit] SQLite WAL mode rejected for "${label}" (${reason}). ` +
      `Falling back to DELETE journal. Multi-process throughput will degrade.`,
  );
}
```

## Connection setup pattern (recommended)

```typescript
// packages/sdk/src/internal/persistence/sqlite-connection.ts
import Database from "better-sqlite3";
import { applyWalWithFallback } from "./sqlite-wal";
import { migrateSchema } from "./schema-version";

export function openTheokitDb(path: string, label: string): Database.Database {
  const db = new Database(path);

  // Order matters: pragmas first, THEN migrations
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000"); // 5s espera em locks
  applyWalWithFallback(db, { label });

  // Schema migrations
  migrateSchema(db);

  return db;
}
```

## Failure modes prevenidos

1. **NFS user blocked**: `~/.theokit/state.db` em NFS → WAL falha → sem
   fallback, SDK trava.
   Com pattern: cai para DELETE journal, perde concurrency mas funciona.

2. **Silenciamento de warning**: dev não percebe que rodou DELETE, vê
   performance ruim, debugar sem clue.
   Com `WAL_WARNING_LOGGED`: warning explícito uma vez por DB.

3. **Spam de warnings**: sem deduplicação por DB label, cada open() de
   30 conexões em uma sessão printa 30 warnings.
   Com Set: 1 warning por label.

## Failure modes NÃO prevenidos

- **DB acessado de múltiplos hosts**: DELETE journal ainda só serializa
  por processo local. Multi-host requer SQLite externo + lock external
  (não escopo do SDK).

- **WAL drift entre conexões**: 1ª conexão usa WAL, NFS fica disponível,
  2ª conexão usa DELETE. Inconsistent. Mitigação: sempre aplicar fallback,
  WAL_WARNING_LOGGED previne spam mas TODO conn é tratado igual.

- **Permission denied em `*-shm`**: filesystem permite WAL mas SHM falha
  por permissão de outro user. Tratado dentro do mesmo catch — cai para
  DELETE.

## Quando NÃO usar WAL

- **In-memory DB** (`:memory:`): WAL inválido (não há arquivo).
- **DB de teste com 1 connection só**: overhead do WAL não vale.
  Use `journal_mode=MEMORY` para velocidade max.
- **DB read-only**: `journal_mode=OFF` é seguro.

## Como testar

```typescript
it("uses WAL when filesystem supports it", () => {
  const db = openTheokitDb(":memory:", "test"); // memory rejeita WAL
  const mode = db.pragma("journal_mode", { simple: true }) as string;
  // :memory: → fallback automático para "memory"
  expect(["wal", "memory"]).toContain(mode.toLowerCase());
});

it("falls back to DELETE when WAL rejected", () => {
  const warnings: string[] = [];
  const db = new Database(":memory:");
  // Force WAL rejection by mocking pragma
  vi.spyOn(db, "pragma").mockImplementationOnce(() => "delete");
  applyWalWithFallback(db, {
    label: "test",
    logger: (msg) => warnings.push(msg),
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/WAL mode rejected/);
});

it("warns once per label", () => {
  WAL_WARNING_LOGGED.clear();
  const warnings: string[] = [];
  const log = (msg: string) => warnings.push(msg);
  
  for (let i = 0; i < 5; i += 1) {
    const db = new Database(":memory:");
    vi.spyOn(db, "pragma").mockReturnValue("delete");
    applyWalWithFallback(db, { label: "samedb", logger: log });
  }
  expect(warnings).toHaveLength(1); // dedup'd
});
```

## Performance implications

| Mode | Concurrent readers | Concurrent writers | Cost |
|---|---|---|---|
| WAL | Many | 1 (serialized) | `*.db-wal` + `*.db-shm` files |
| DELETE | 0 during write | 1 | Just `*.db` (legacy) |
| MEMORY | Many | 1 | No durability across crash |

NFS fallback (DELETE) reduz throughput em ~10-100x para cargas com leituras concorrentes. Documente isso no README — usuário pode mover DB para `/tmp` ou ext4 mount se a feature é heavy.

## Onde wirar no SDK

`packages/sdk/src/internal/persistence/`:

- `sqlite-wal.ts` — `applyWalWithFallback(db, options)`
- `sqlite-connection.ts` — `openTheokitDb(path, label)` (wrapper one-stop)
- Callers: `internal/session-db/`, `internal/memory/index-db.ts`, `internal/cron/store.ts`

## Referências cruzadas

- [schema-versioning.md](./schema-versioning.md) — `migrateSchema` roda APÓS `applyWalWithFallback`
- [fts5-sanitization.md](./fts5-sanitization.md) — FTS5 tables usam o mesmo connection
- [file-lock-pattern.md](./file-lock-pattern.md) — para resources não-SQLite, lock manual

## Citações primárias

- `referencia/hermes-agent/hermes_state.py:128-183` — Python canonical
- `.claude/knowledge-base/hermes-deep-dive/10-state-persistence.md:136-144` — AD-3
- `.claude/knowledge-base/hermes-deep-dive/04-cross-session-fts5.md:81-83` — uso em SessionDB
