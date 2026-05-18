# TOCTOU Race Prevention

> Time-Of-Check / Time-Of-Use — operação onde você check property
> ("file is mine, path is safe, lock is free") e DEPOIS use it. Entre
> check e use, attacker (or concurrent process) muta state →
> security/data corruption. Hermes shipou e fixou 4+ TOCTOU windows
> em v0.4 + v0.13. Padrão: **atomicize check+use, ou re-verify dentro
> da operação**.

## Quando aplicar

Aplique quando o código faz:

- Stat → read/write
- Lookup → mutate (read state, modify based on read)
- Path validate → file open
- Lock check → acquire
- Permission check → execute action

Cenários típicos em SDK:

- Credential file write (check exists → atomic write → could replace)
- File-lock acquire (check stale → take over → other process also takes)
- Path sanitize → open (path replaced by symlink between check + open)
- Read jobs.json → write jobs.json (cron `get_due_jobs` v0.4 #1716)

## Por que importa

Hermes shipou:

| PR | Versão | TOCTOU |
|---|---|---|
| #1716 | v0.4 | Cron `get_due_jobs` reads jobs.json twice (race window) |
| #2406, #1908 | v0.4 | Restart with `--replace` racing PID file |
| #1726 | v0.4 | Memory provider concurrent writes silently dropping entries |
| #2154 | v0.4 | MCP duplicate registration on concurrent file access |
| #19874 | v0.13 | Cron `get_due_jobs` parallel write corruption (recorrência) |
| #21176 | v0.13 | MCP OAuth credential save TOCTOU |
| #21194 | v0.13 | `hermes_cli/auth.py` credential writers TOCTOU |

Same `get_due_jobs` race re-shipped 9 releases later. TOCTOU é fácil
de re-introduzir sem disciplina.

## Pattern 1: Atomic op (when possible)

Se a operação pode ser feita em UM syscall, faça:

```typescript
// VULNERABLE: 2 ops, race in middle
if (!existsSync(path)) {
  writeFileSync(path, data); // attacker creates file between exist check and write
}

// SAFE: single op with flag
writeFileSync(path, data, { flag: "wx" }); // wx = "exclusive create"; fails if exists
```

Examples:

| Pattern | TS API |
|---|---|
| Create-if-not-exists | `writeFile(path, data, { flag: "wx" })` |
| Open-for-append | `open(path, "a")` (atomic with respect to writes) |
| Rename atomic | `rename(tmp, target)` (single syscall) |
| Compare-and-swap (SQLite) | `UPDATE ... WHERE status='ready' AND lock=NULL` |
| Compare-and-swap (memory) | Atomics in SharedArrayBuffer (overkill for SDK) |

## Pattern 2: Lock + re-verify

Quando atomic op não existe, **lock the path** durante check+use:

```typescript
// VULNERABLE: check then use
async function safeRead(path: string): Promise<string> {
  if (!isSymlink(path) && isUnderBase(path)) {
    return readFile(path, "utf-8"); // attacker swaps to symlink during this window
  }
  throw new Error(...);
}

// SAFE: lock and re-verify atomically
async function safeRead(path: string): Promise<string> {
  return withFileLock(path + ".rdlock", async () => {
    // Re-check inside lock
    if (isSymlink(path) || !isUnderBase(path)) {
      throw new Error(...);
    }
    return readFile(path, "utf-8");
  });
}
```

Hermes' `skill_usage.bump_use` pattern (v0.4 #1726 fix):

```python
# tools/skill_usage.py:67-96
with _usage_file_lock():
    # All reads + writes inside lock — no race window
    usage = read_usage_json()
    usage[name]["use_count"] += 1
    atomic_write_json(USAGE_PATH, usage)
```

## Pattern 3: O_EXCL semantics

Linux/macOS native: open with `O_EXCL` flag fails if file exists.

```typescript
import { open } from "node:fs/promises";

async function createIfAbsent(path: string, data: string): Promise<boolean> {
  try {
    const handle = await open(path, "wx"); // O_EXCL semantics
    try {
      await handle.writeFile(data);
      return true; // created
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false; // already existed
    }
    throw err;
  }
}
```

Use case: PID file creation (Hermes' `--replace` race fix).

## Pattern 4: Idempotent operations

Quando 2 caminhos podem rodar a mesma operação concorrentemente, faça
a operação **idempotent**. Multiple wins is OK porque resultado é
mesmo:

```typescript
// Multiple processes trying to mkdir
async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  // recursive: true não falha se já existe
}

// Multiple processes registering same plugin
function registerPlugin(plugin: Plugin): void {
  if (REGISTRY.has(plugin.name)) {
    // Last-writer-wins (acceptable for read-only profiles)
    if (existing.version === plugin.version) return; // idempotent no-op
    logger.warn(`Plugin override: ${plugin.name}`);
  }
  REGISTRY.set(plugin.name, plugin);
}
```

## Pattern 5: Transactional state (SQLite)

`BEGIN IMMEDIATE` + CAS:

```sql
-- VULNERABLE: 2 statements
SELECT status FROM tasks WHERE id = ?;
-- (race window)
UPDATE tasks SET status = 'running' WHERE id = ?;

-- SAFE: single CAS
UPDATE tasks SET status = 'running', claim = ?
WHERE id = ? AND status = 'ready' AND claim IS NULL;
-- Returns affected rows; 0 means race lost
```

Hermes' kanban `claim_task` (`kanban_db.py:1922-1934`) is this pattern.

```typescript
// TypeScript via better-sqlite3
const claim = db.prepare(`
  UPDATE tasks
  SET status = 'running', claim_lock = ?, claim_expires = ?
  WHERE id = ? AND status = 'ready' AND claim_lock IS NULL
`);

const result = claim.run(lockId, expires, taskId);
if (result.changes === 0) {
  return null; // race lost — someone else claimed
}
// We hold the claim
```

## Pattern 6: Sequence numbers

Each write increments a counter. Read counter at check time. Compare at
use time.

```typescript
// Optimistic concurrency
const beforeWrite = read({
  path: "...",
  parse: (data) => ({ data, sequence: data.sequence }),
});

// ... do work ...

await transaction(async () => {
  const current = await readSequence();
  if (current !== beforeWrite.sequence) {
    throw new ConflictError("modified by another process");
  }
  await writeWith(beforeWrite.sequence + 1);
});
```

Adequate for low-contention. SQLite does this internally for row
versioning.

## Failure modes prevenidos

1. **Symlink race during open**: attacker swaps file → symlink between
   stat and open. Pattern: lock + re-verify, or atomic open with
   `O_NOFOLLOW`.

2. **Lost write (concurrent appends)**: 2 processes read jobs.json,
   modify, write — second overwrites first. Pattern: file lock OR
   SQLite transaction.

3. **Duplicate PID file**: process A checks no PID file → creates →
   process B simultaneously does the same. Both think they're singleton.
   Pattern: O_EXCL create.

4. **Stale claim taken twice**: process A sees claim is stale (expired),
   takes over → process B simultaneously sees same → both think
   they own. Pattern: SQLite CAS with `WHERE expires < now AND
   newly_claimed = ?` (claim_id increments).

## Failure modes NÃO prevenidos

- **Fileysystem-level races**: NFS where flock isn't honored. Defesa:
  document; recommend ext4/APFS for SDK state.

- **Network filesystem inconsistency**: NFS/SMB caching can return
  stale data. Defesa: same — document; users with NFS HOME accept
  weaker guarantees.

- **Logical races (business logic)**: order processed twice because UX
  showed "confirmed" before commit. Defesa: idempotency keys at API
  level (not SDK concern).

## Como testar

```typescript
it("concurrent claims of same task — only one wins", async () => {
  await db.exec(`INSERT INTO tasks (id, status) VALUES ('t1', 'ready')`);
  
  const results = await Promise.all([
    claimTask(db, "t1"),
    claimTask(db, "t1"),
    claimTask(db, "t1"),
  ]);
  
  const winners = results.filter((r) => r !== null);
  expect(winners.length).toBe(1); // exactly one
});

it("PID file creation: only one process wins", async () => {
  const pidPath = join(tmpdir(), "test.pid");
  await rm(pidPath, { force: true });
  
  const creates = await Promise.all([
    createIfAbsent(pidPath, "1"),
    createIfAbsent(pidPath, "2"),
    createIfAbsent(pidPath, "3"),
  ]);
  
  expect(creates.filter((r) => r).length).toBe(1);
});

it("counter increment under concurrent locks", async () => {
  const path = join(tmpdir(), "counter.json");
  await writeFile(path, '{"n":0}');
  
  await Promise.all(Array.from({ length: 100 }, () =>
    withFileLock(path, async () => {
      const data = JSON.parse(await readFile(path, "utf-8"));
      data.n += 1;
      await atomicWriteJson(path, data);
    })
  ));
  
  const final = JSON.parse(await readFile(path, "utf-8"));
  expect(final.n).toBe(100); // sem lock seria < 100
});

it("symlink race detection re-checks inside lock", async () => {
  const path = join(tmpdir(), "safe.txt");
  await writeFile(path, "ok");
  
  // Pretend attacker swaps to symlink mid-operation
  const readPromise = withFileLock(path + ".rdlock", async () => {
    await new Promise((r) => setTimeout(r, 100)); // attacker window
    // Re-check
    if (lstatSync(path).isSymbolicLink()) {
      throw new PathTraversalError(path, "...");
    }
    return readFile(path, "utf-8");
  });
  
  // Concurrently swap (simulated)
  setTimeout(() => {
    unlinkSync(path);
    symlinkSync("/etc/passwd", path);
  }, 50);
  
  await expect(readPromise).rejects.toThrow(PathTraversalError);
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/security/`:

- `toctou-helpers.ts` — `createIfAbsent`, `withFileLock` wrap (já em file-lock.ts)
- Callers usam patterns acima diretamente — não há "1 helper para tudo"

Audit:

```bash
# Find potential TOCTOU windows
grep -rn "existsSync.*write\|statSync.*open" packages/sdk/src/
```

Each result → audit: race window? If yes, use atomic op OR lock.

## Referências cruzadas

- [atomic-write-pattern.md](./atomic-write-pattern.md) — atomic rename é o backbone
- [file-lock-pattern.md](./file-lock-pattern.md) — lock + re-verify pattern
- [path-traversal-vectors.md](./path-traversal-vectors.md) — symlink races are TOCTOU subcase

## Citações primárias

- v0.4 #1716, #2406, #1908, #1726, #2154 — early TOCTOU closures
- v0.13 #19874, #21176, #21194 — recurrence (TOCTOU é fácil re-introduzir)
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:195-206` — TOCTOU + concurrent write list
- Hermes' `kanban_db.py:1922-1934` — canonical SQLite CAS pattern
