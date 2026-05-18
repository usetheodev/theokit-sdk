# File Lock Pattern

> Cross-process write serialization via OS-level file locks (`fcntl` POSIX,
> `msvcrt` Windows). Use quando duas ou mais instâncias do mesmo processo
> ou processos diferentes podem competir pelo mesmo recurso.
> [`atomic-write-pattern.md`](./atomic-write-pattern.md) protege contra
> crash-mid-write; **file locks protegem contra escritas concorrentes**.

## Quando aplicar

Aplique sempre que:

- Múltiplos processos podem escrever no MESMO arquivo (cron `.tick.lock`, kanban heartbeat)
- Apenas um processo deve "owns" um recurso de cada vez (gateway bot tokens, dispatcher)
- Você precisa de barreira entre "claim → work → release"

Não aplique quando:

- A escrita é dentro de UM processo (atomic-write basta)
- O recurso é SQLite (WAL+`BEGIN IMMEDIATE` já serializa)
- A operação é read-only

## Sites reais no Hermes

| Lock path | Por quê | Source |
|---|---|---|
| `~/.hermes/cron/.tick.lock` | Previne tick scheduler duplicado entre processos | `AGENTS.md:787` |
| `~/.hermes/skills/.usage.json.lock` | Serializa `skill_usage.bump_use` | `tools/skill_usage.py:67-96` |
| Kanban claim_lock | Per-task lock via SQLite CAS (não fcntl) | `hermes_cli/kanban_db.py:1922-1934` |
| Gateway platform tokens | Telegram bot pode ter só 1 polling client | `AGENTS.md:912-916`, `gateway/platforms/telegram.py` |

Pattern recorre **4+ vezes** no Hermes para resources não-SQLite.

## Pattern canonical (Python)

```python
# Padrão Hermes (fcntl em POSIX, msvcrt em Windows)
import fcntl
from pathlib import Path
from contextlib import contextmanager

@contextmanager
def file_lock(lock_path: Path, *, exclusive: bool = True, timeout: float = 30.0):
    """Block until lock acquired or timeout. Releases on exit."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w") as f:
        flags = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        # Linux: blocking call; Hermes wraps in select() loop for timeout
        fcntl.flock(f.fileno(), flags)
        try:
            yield
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
```

## TypeScript equivalent

Usar [`proper-lockfile`](https://github.com/moxystudio/node-proper-lockfile) — biblioteca battle-tested, suporta Linux/macOS/Windows, com stale-lock detection.

```typescript
// packages/sdk/src/internal/persistence/file-lock.ts
import { lock as acquireLock } from "proper-lockfile";

export async function withFileLock<T>(
  resourcePath: string,
  fn: () => Promise<T>,
  options?: { stale?: number; retries?: number },
): Promise<T> {
  const release = await acquireLock(resourcePath, {
    stale: options?.stale ?? 30_000, // lock vira stale após 30s
    retries: {
      retries: options?.retries ?? 5,
      minTimeout: 100,
      maxTimeout: 2_000,
      factor: 2,
    },
    realpath: false, // permite lockar caminhos que ainda não existem
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}
```

**Notas**:

1. **`stale` é crítico** — sem stale detection, um processo morto deixa lock zumbi.
   30s é o default do Hermes. Aumente se a operação demora mais.
2. **Retry com exponential backoff** — sem isso, contenção alta causa ENOENT em cascade.
3. **`realpath: false`** — necessário para lockar `~/.theokit/cron/.tick.lock` quando o arquivo de fato não existe (mas o diretório existe).

## Failure modes prevenidos

1. **Concurrent writes corrompendo o mesmo arquivo**: dois processos chamam `atomicWriteJson(jobs.json)` ao mesmo tempo → o último a fazer `rename` vence, os jobs do outro processo somem.
   Com lock: serializado, ambos persistem.

2. **Race condition em "claim → work → release"**: processo A lê estado, decide claim, processo B lê estado idêntico, ambos claimam. Ambos trabalham, ambos consideram "won".
   Com lock: A claima, B espera, B lê estado novo, B sabe que A já claimou.

3. **Tick scheduler duplicado**: dois gateways rodando no mesmo `HERMES_HOME` (operacional, não previsto) → mesma job dispara 2x.
   Com `.tick.lock`: tick é mutuamente exclusivo.

## Failure modes NÃO prevenidos

- **Processo crash entre claim e release**: `proper-lockfile` detecta via `stale` timeout. Mas durante a janela de stale (30s default), recurso fica órfão.
  Mitigação: heartbeat dentro de operações longas, refresh do lock.

- **NFS/SMB sem flock**: alguns mounts não suportam flock; `proper-lockfile` cai pra "lockfile method" (cria arquivo lock e checa modtime). Menos confiável.
  Mitigação: documentar que features que precisam de lock não funcionam em NFS legado.

- **Reentrância no mesmo processo**: chamar `withFileLock(p, () => withFileLock(p, ...))` causa deadlock — `proper-lockfile` não é reentrant.
  Mitigação: nunca aninhe locks no mesmo path.

## Quando NÃO usar

- **Operações com SQLite**: WAL + `BEGIN IMMEDIATE` é o lock que você quer (database-level, não filesystem).
- **Read-heavy + rare writes**: locking puro de leitura tem overhead. Considere read-write lock só se medições mostrarem que vale.
- **Operações curtíssimas (<10ms)**: o cost do lock pode exceder o trabalho. Considere atomicidade lógica (single SQL statement, atomic-write).

## Como testar

Test: contenção simulada — 50 processos tentando incrementar contador

```typescript
it("serializes concurrent counter increments", async () => {
  const counterPath = join(tmpdir(), "counter.json");
  await writeFile(counterPath, JSON.stringify({ count: 0 }));

  const increment = () =>
    withFileLock(counterPath, async () => {
      const data = JSON.parse(await readFile(counterPath, "utf-8"));
      data.count += 1;
      await atomicWriteJson(counterPath, data);
    });

  await Promise.all(Array.from({ length: 50 }, increment));
  const final = JSON.parse(await readFile(counterPath, "utf-8"));
  expect(final.count).toBe(50); // sem lock, contador < 50 garantido
});
```

Test: stale lock recovery

```typescript
it("recovers from stale lock left by crashed process", async () => {
  const path = join(tmpdir(), "resource.json");
  // Simula lock zumbi de processo morto
  await writeFile(path + ".lock/0", "1234"); // PID inválido

  const start = Date.now();
  await withFileLock(path, async () => { /* work */ }, { stale: 100 });
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(500); // não trava mais que stale + retries
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/persistence/`:

- `file-lock.ts` — `withFileLock(path, fn, options)` (peer dep: `proper-lockfile`)
- `index.ts` — re-export

Callers que devem usar:

- `Cron` scheduler tick (`packages/sdk/src/cron.ts` → `Scheduler.tick()`)
- `Memory` skill usage bump (próximo doc — `Memory.skills.bumpUsage`)
- Qualquer feature multi-process que escreva JSON state

## Referências cruzadas

- [atomic-write-pattern.md](./atomic-write-pattern.md) — para a escrita em si dentro do lock
- [toctou-race-prevention.md](./toctou-race-prevention.md) — quando lock + read-modify-write não basta
- [profile-isolation.md](./profile-isolation.md) — lock paths são relativos ao `THEOKIT_HOME`

## Citações primárias

- `referencia/hermes-agent/AGENTS.md:787,912-916` — discipline geral
- `referencia/hermes-agent/tools/skill_usage.py:67-96` — pattern Python canonical
- `.claude/knowledge-base/hermes-deep-dive/10-state-persistence.md:146-156` — AD-4
- `referencia/hermes-agent/hermes_cli/kanban_db.py:1922-1934` — SQLite CAS variant (alternativa)
