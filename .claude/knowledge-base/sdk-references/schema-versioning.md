# Schema Versioning

> Quando o shape de dados persistidos muda entre releases, **migra forward
> sem deletar dados do usuário**. Hermes está em `SCHEMA_VERSION = 11`
> (10 migrações forward-only desde v0.2). Cada bump tem migrator que
> roda na abertura do DB. Sem versioning, upgrade vira "you have to
> rm -rf ~/.hermes" — quebra trust.

## Quando aplicar

Aplique sempre que persistir state estruturado:

- SQLite tables (sessions, kanban, embeddings)
- JSON config files com schema (`config.yaml`, `cron/jobs.json`)
- Skill files com frontmatter contract

Não aplique para:

- Cache regenerável (`.theokit/cache/`)
- Logs (append-only)
- User-provided files (workspace)

## Por que importa

Hermes shipou 12 minor releases em 8 semanas. Schema bumpa **toda
release que adiciona feature**. Sem migrador automático, usuários teriam
que escolher entre:

- Perder o session history (rm `state.db`)
- Manter na versão antiga
- Migrar manualmente (impossível para non-devs)

Lista de schema changes do Hermes (`hermes-deep-dive/00-orientation.md:119`):

- v6 (v0.5 #2974): adicionou `reasoning`, `reasoning_details`, `codex_reasoning_items` columns
- v0.4 #1776: FTS5 hyphenated queries fix
- v0.4 #1892: search-all-sources default
- v0.4 #1744: corrupt `load_transcript` lines
- v0.4 #2157: case-sensitive duplicates
- v0.4 #2194: no-sessions crash
- v0.7 #4549: quote dotted terms
- v0.12 #16915: quote underscored terms
- v0.12 #16651: trigram CJK index
- v0.12 #16914: index `tool_name`+`tool_calls` + repair-migrate FTS5 schema drift

Cada uma rodou automaticamente no upgrade. Zero data loss reportado.

## Pattern canonical (Python — SQLite version)

```python
# hermes_state.py:36 (simplified)
SCHEMA_VERSION = 11

class SessionDB:
    def __init__(self):
        self.conn = sqlite3.connect(...)
        self._migrate()

    def _migrate(self):
        current = self._get_user_version()
        if current == SCHEMA_VERSION:
            return
        if current > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database is v{current}, SDK expects v{SCHEMA_VERSION}. "
                f"Downgrade rejected."
            )
        for v in range(current + 1, SCHEMA_VERSION + 1):
            migrator = _MIGRATIONS[v]
            migrator(self.conn)  # forward-only
            self._set_user_version(v)

_MIGRATIONS = {
    2: _migrate_v1_to_v2,
    3: _migrate_v2_to_v3,
    # …
    11: _migrate_v10_to_v11,
}

def _get_user_version(conn):
    return conn.execute("PRAGMA user_version").fetchone()[0]

def _set_user_version(conn, v):
    conn.execute(f"PRAGMA user_version = {v}")
```

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/persistence/schema-version.ts
import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 1;

type Migrator = (db: Database.Database) => void;

const MIGRATIONS: Record<number, Migrator> = {
  // 2: migrateV1ToV2,
  // ...
};

export class SchemaMismatchError extends Error {
  constructor(public actual: number, public expected: number) {
    super(`Database is v${actual}, SDK expects v${expected}. Downgrade rejected.`);
  }
}

export function migrateSchema(db: Database.Database): void {
  const current = (db.pragma("user_version", { simple: true }) as number) ?? 0;

  if (current === SCHEMA_VERSION) return;

  if (current > SCHEMA_VERSION) {
    throw new SchemaMismatchError(current, SCHEMA_VERSION);
  }

  // Transaction wraps all migrations — if any fail, DB stays at previous version
  const tx = db.transaction(() => {
    for (let v = current + 1; v <= SCHEMA_VERSION; v += 1) {
      const migrator = MIGRATIONS[v];
      if (migrator === undefined) {
        throw new Error(`Missing migrator for version ${v}`);
      }
      migrator(db);
      db.pragma(`user_version = ${v}`);
    }
  });
  tx();
}
```

## Pattern para JSON config

JSON não tem `PRAGMA user_version`. Use campo `_schemaVersion`:

```typescript
// packages/sdk/src/internal/persistence/json-schema.ts
interface VersionedJson {
  _schemaVersion: number;
  [key: string]: unknown;
}

export async function readVersionedJson<T extends VersionedJson>(
  path: string,
  migrators: Record<number, (prev: T) => T>,
  currentVersion: number,
): Promise<T> {
  const raw = JSON.parse(await readFile(path, "utf-8")) as T;
  const v = raw._schemaVersion ?? 1;
  if (v === currentVersion) return raw;
  if (v > currentVersion) throw new SchemaMismatchError(v, currentVersion);

  let data = raw;
  for (let i = v + 1; i <= currentVersion; i += 1) {
    const migrator = migrators[i];
    if (migrator === undefined) throw new Error(`Missing migrator for v${i}`);
    data = migrator(data);
    data._schemaVersion = i;
  }
  await atomicWriteJson(path, data);
  return data;
}
```

## Discipline: forward-only

**Sempre forward**: v3 → v4 → v5, nunca v5 → v4. Razões:

1. **Downgrade do SDK** + DB já migrado = comportamento indefinido. Melhor falhar explícito (`SchemaMismatchError`) que silenciosamente quebrar.
2. **Migrators inversos** dobram surface de teste e raramente são exercitados. Hermes nunca implementou.
3. **Archive em vez de revert**: features que removem dados (curator archive, checkpoint v2 prune) movem para `legacy-*/`, não deletam.

## Migration types — additive vs structural

**Additive** (adicionar coluna/campo): zero risk. Default value para legacy rows.

```typescript
function migrateV1ToV2(db: Database.Database): void {
  db.exec(`ALTER TABLE sessions ADD COLUMN model TEXT DEFAULT ''`);
}
```

**Structural** (rename, split, drop): risco maior. Sempre teste em fixtures realistas antes de shipar.

```typescript
function migrateV2ToV3(db: Database.Database): void {
  // RENAME column: SQLite requires recreate-and-copy
  db.exec(`
    ALTER TABLE sessions RENAME COLUMN provider TO provider_old;
    ALTER TABLE sessions ADD COLUMN provider TEXT;
    UPDATE sessions SET provider = COALESCE(provider_old, 'unknown');
    ALTER TABLE sessions DROP COLUMN provider_old;
  `);
}
```

Hermes evita rename quando possível — usa `COALESCE(new_col, old_col)` em queries e marca `old_col` como deprecated por 1-2 releases antes de drop (per `kanban_db.py:1024-1035` migrava `spawn_failures` → `consecutive_failures`).

## Failure modes prevenidos

1. **Upgrade que corrompe DB**: sem migrator, código novo lê schema velho, parse falha, exception em runtime.
   Com pattern: migrator executa no open, DB sempre na versão esperada.

2. **Downgrade silencioso**: dev faz `pnpm install @usetheo/sdk@1.2.0` em produção com DB v1.3, código não nota que está vendo schema "do futuro".
   Com pattern: `SchemaMismatchError` falha explícita.

3. **Migration parcial em crash**: migração v3→v4 escreve metade, processo morre, próximo open vê schema híbrido.
   Com transaction wrap: tudo dentro de `BEGIN; ... COMMIT;`, crash mid-migration rola back.

## Failure modes NÃO prevenidos

- **Migrator buggy**: a única defesa é teste com fixtures realistas
  (DB v3 real, run migrator, verificar v4 esperado).

- **Schema bump esquecido**: dev altera CREATE TABLE mas esquece de
  bumpar `SCHEMA_VERSION`. Defesa: `_migrate()` testa no CI contra fixture
  v1 e verifica que estado final tem todas colunas esperadas.

## Como testar

```typescript
it("migrates v1 fixture to current SCHEMA_VERSION", () => {
  const db = new Database(":memory:");
  // Setup v1 schema manualmente
  db.exec(`CREATE TABLE sessions (id TEXT, started_at INTEGER)`);
  db.pragma("user_version = 1");

  migrateSchema(db);

  expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  const cols = db.pragma("table_info(sessions)") as { name: string }[];
  expect(cols.map((c) => c.name)).toContain("model"); // adicionada em v2
});

it("rejects downgrade", () => {
  const db = new Database(":memory:");
  db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
  expect(() => migrateSchema(db)).toThrow(SchemaMismatchError);
});

it("rolls back partial migration on crash", () => {
  const db = new Database(":memory:");
  db.pragma("user_version = 1");
  // Force throw mid-migration
  MIGRATIONS[2] = () => { throw new Error("simulated crash"); };
  expect(() => migrateSchema(db)).toThrow("simulated crash");
  expect(db.pragma("user_version", { simple: true })).toBe(1); // rolled back
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/persistence/schema-version.ts` — helpers reutilizáveis.

Migrações específicas vivem por feature:

- `internal/session-db/migrations.ts` — sessions, FTS5 tables
- `internal/cron/migrations.ts` — jobs.json shape
- `internal/memory/migrations.ts` — embedding index schema

## Referências cruzadas

- [atomic-write-pattern.md](./atomic-write-pattern.md) — JSON migrations rewrite atomically
- [sqlite-wal-fallback.md](./sqlite-wal-fallback.md) — migration runs após WAL setup
- [testing-invariant-vs-snapshot.md](./testing-invariant-vs-snapshot.md) — test migration shape, não exact rows

## Citações primárias

- `referencia/hermes-agent/hermes_state.py:36` — `SCHEMA_VERSION = 11`
- `.claude/knowledge-base/hermes-deep-dive/10-state-persistence.md:210-218` — AD-9
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:119-122` — lista de FTS5 schema fixes
- `referencia/hermes-agent/hermes_cli/kanban_db.py:1024-1035` — pattern COALESCE para rename
