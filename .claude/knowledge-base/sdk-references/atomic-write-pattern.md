# Atomic Write Pattern

> Toda escrita de arquivo persistente do SDK deve seguir o pattern
> **temp file + fsync + rename**. Um crash mid-write não pode corromper o
> arquivo original. Power loss não pode deixar dados parcialmente
> escritos. Essa é a base sobre a qual `config.yaml`, `cron/jobs.json`,
> skills, e qualquer outro state-file precisa repousar.

## Quando aplicar

Aplique este pattern **sempre** que estiver escrevendo JSON/YAML/texto em
disco e:

- O arquivo é lido por OUTROS processos (cron tick, gateway, CLI)
- O arquivo guarda estado que sobrevive ao restart
- Perda parcial seria pior que perda total (config malformado vs config velho)

Não aplique quando:

- O arquivo é temporário (cache regenerável, logs append-only)
- Você está escrevendo em SQLite (o WAL já faz o equivalente atômico)
- Você está append-only num log (use `fs.appendFile` direto)

## Por que importa — sites reais no Hermes

Lista compacta de arquivos que **usam esse pattern** no Hermes (fonte:
`hermes-deep-dive/10-state-persistence.md:106-176` e `00-orientation.md:100-110`):

| Arquivo | Por quê | Source PR |
|---|---|---|
| `~/.hermes/config.yaml` | Config do usuário, lido por todo módulo | v0.6 #3800 |
| `~/.hermes/.env` | Secrets (0600 perms), lido por providers | v0.2 #954 |
| `~/.hermes/cron/jobs.json` | Cron jobs, lido pelo tick scheduler | v0.2 #146 |
| `~/.hermes/sessions.json` | Legacy session metadata | v0.2 #611 |
| Checkpoint files | Process state snapshot | v0.2 #298 |
| Skill files | Skill definitions, lidos pelo tool registry | v0.2 #551 |
| Batch runner state | Long-running batch progress | v0.2 #297 |
| `update-pending` state | Self-update orchestration | v0.8 #4923 |
| `save_job_output` | Per-job stdout history | v0.3 #1173 |
| Profile import tar archives | Validate paths against zip-slip | v0.7 #4318 |
| Curator state | `agent/curator.py:97-115` (canonical impl) | v0.12 |

Padrão recorre **11 vezes** no Hermes. Não é coincidência — é discipline.

## Pattern canonical (Python, fonte: `agent/curator.py:97-115`)

```python
import os
import json
import tempfile
from pathlib import Path

def atomic_write_json(path: Path, data: dict) -> None:
    """Write JSON to path atomically. Crash mid-write leaves original intact."""
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}_",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())  # durabilidade contra power loss
        os.replace(tmp, path)  # rename atômico (POSIX guarantee)
    except Exception:
        # cleanup do temp se algo falhou ANTES do replace
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
```

## TypeScript equivalent (proposto para `@usetheo/sdk`)

```typescript
// packages/sdk/src/internal/persistence/atomic-write.ts
import { writeFile, rename, unlink, open } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";

export async function atomicWriteJson(
  path: string,
  data: unknown,
  options?: { indent?: number; mode?: number },
): Promise<void> {
  const dir = dirname(path);
  const name = basename(path);
  const suffix = randomBytes(6).toString("hex");
  const tmp = join(dir, `.${name}_${suffix}.tmp`);
  const json = JSON.stringify(data, null, options?.indent ?? 2);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Abrimos manualmente para chamar fsync — writeFile não expõe o fd
    handle = await open(tmp, "w", options?.mode ?? 0o644);
    await handle.writeFile(json, { encoding: "utf-8" });
    await handle.sync(); // fsync — durabilidade contra power loss
    await handle.close();
    handle = undefined;
    await rename(tmp, path); // atômico em Linux/macOS/Windows
  } catch (cause) {
    if (handle !== undefined) {
      await handle.close().catch(() => {});
    }
    await unlink(tmp).catch(() => {}); // best-effort cleanup
    throw cause;
  }
}
```

**Notas sobre a tradução TS**:

1. **`fs.promises.writeFile` sozinho NÃO é atômico** — escreve no path direto.
   Use o pattern temp + rename mesmo em Node.
2. **`handle.sync()` é o `fsync`** — sem isso, em power loss você perde o
   arquivo mesmo após `rename` completar.
3. **`rename` é atômico** em todos os 3 sistemas de arquivos mainstream
   (ext4/APFS/NTFS) quando source e dest estão no MESMO filesystem. Não
   atravesse mount points.
4. **Cleanup do temp** em catch path é best-effort (`.catch(() => {})`).
   Pior caso: arquivo temp órfão fica no disco. Não corrompe nada.
5. **Permissões**: passe `mode: 0o600` para arquivos com secrets (`.env`,
   credentials).

## Failure modes que esse pattern PREVINE

1. **Crash mid-write**: o processo morre depois de truncar e antes de
   escrever todo o JSON. Sem o pattern, o arquivo original vira metade do
   novo. Com o pattern, o arquivo original fica intacto até o `rename`.

2. **Power loss durante a escrita**: o OS bufferiza writes. Sem `fsync`,
   o arquivo pode "voltar" para o estado anterior após boot, mesmo que
   `write()` tenha retornado. Com `fsync`, o conteúdo está no disco antes
   do `rename` ocorrer.

3. **Outro processo lendo durante a escrita**: sem rename atômico, leitor
   pode pegar o arquivo no meio da escrita (JSON incompleto, parse error).
   Com rename, leitor ou vê o arquivo velho, ou vê o arquivo novo —
   nunca um arquivo parcial.

4. **Disco cheio**: sem o pattern, o write falha no meio e corrompe o
   arquivo. Com o pattern, o write no temp falha, o original fica
   intacto, e o catch path limpa o temp.

5. **Concurrent writes do mesmo processo**: `randomBytes(6)` no nome do
   temp evita colisão se duas operações estão acontecendo em paralelo.
   Sem o suffix random, dois writes simultâneos colidem no temp e um
   sobrescreve o outro.

## Failure modes que esse pattern NÃO previne

- **Concurrent writes de DIFERENTES processos**: dois processos escrevendo
  no mesmo path se "sobrescrevem" — o último a fazer `rename` vence. Para
  isso, use `file-lock-pattern.md` (próximo doc).

- **Bug lógico no caller**: se o `data` que você passou já está inválido,
  o pattern atomicamente persiste o lixo. Validação antes do write é
  responsabilidade do caller.

- **Filesystem que NÃO suporta atomic rename**: alguns FUSE drivers e
  NFS implementations antigas violam o atomic-rename guarantee. Para
  esses, considere SQLite ou um lock externo.

## Quando NÃO usar este pattern

- **Logs append-only**: `fs.appendFile(path, line)` é suficiente. Pattern
  do rename geraria N temp files por linha — lentíssimo.

- **Caches regeneráveis**: se o conteúdo pode ser reconstruído de outra
  fonte, perder o arquivo todo é OK. Não precisa do pattern.

- **SQLite databases**: WAL mode + `BEGIN IMMEDIATE` já dá o equivalente
  atômico para writes estruturados. Não wrappe em atomic-write.

- **Streaming downloads**: você precisa do conteúdo parcial visível em
  disco enquanto baixa. Pattern do rename quebra isso.

## Como testar

Test 1: **crash simulation** (verifica que o arquivo original sobrevive)

```typescript
// tests/internal/atomic-write.test.ts
it("preserves original file when write fails mid-stream", async () => {
  const target = join(tmpdir(), "config.json");
  await writeFile(target, '{"version":1}');
  
  // Simula falha no fsync: stub para throw
  const handleMock = vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
    const h = await fsPromises.open.wrappedMethod(...args);
    h.sync = async () => { throw new Error("fsync failed"); };
    return h;
  });
  
  await expect(atomicWriteJson(target, { version: 2 })).rejects.toThrow("fsync failed");
  const after = JSON.parse(await readFile(target, "utf-8"));
  expect(after.version).toBe(1); // original intacto
  
  handleMock.mockRestore();
});
```

Test 2: **concurrent reads não veem arquivo parcial**

```typescript
it("concurrent readers see either old or new content, never partial", async () => {
  const target = join(tmpdir(), "config.json");
  await writeFile(target, '{"v":1,"data":"old"}');
  
  const write = atomicWriteJson(target, { v: 2, data: "new" });
  const reads = Array.from({ length: 50 }, () =>
    readFile(target, "utf-8").then((s) => JSON.parse(s).data),
  );
  
  await write;
  const results = await Promise.all(reads);
  for (const r of results) {
    expect(["old", "new"]).toContain(r); // nunca undefined, nunca SyntaxError
  }
});
```

Test 3: **temp files não vazam no error path**

```typescript
it("cleans up temp file when rename fails", async () => {
  const target = join(tmpdir(), "config.json");
  
  vi.spyOn(fsPromises, "rename").mockRejectedValueOnce(new Error("EPERM"));
  await expect(atomicWriteJson(target, { v: 1 })).rejects.toThrow("EPERM");
  
  const tempsLeft = (await readdir(tmpdir())).filter((f) =>
    f.startsWith(`.config.json_`),
  );
  expect(tempsLeft).toHaveLength(0);
});
```

## Onde wirar no SDK

Helpers em `packages/sdk/src/internal/persistence/`:

- `atomic-write.ts` — `atomicWriteJson(path, data)`, `atomicWriteText(path, text)`
- `index.ts` — barrel re-export para internal use

Callers que devem migrar para o helper (audit):

```bash
# Encontrar writes não-atômicos no SDK
grep -rn "fs.writeFile\|fs.promises.writeFile" packages/sdk/src/ \
  | grep -v "test" | grep -v "atomic-write.ts"
```

Cada hit é candidato a auditoria: "esse write precisa ser atômico ou não?"

## Referências cruzadas

- [file-lock-pattern.md](./file-lock-pattern.md) — quando múltiplos
  processos escrevem o mesmo arquivo
- [profile-isolation.md](./profile-isolation.md) — onde `path` vem de
  (`getTheokitHome()` + relativo)
- [schema-versioning.md](./schema-versioning.md) — quando o `data` muda
  de shape entre releases

## Citações primárias

- `referencia/hermes-agent/agent/curator.py:97-115` — Python canonical
- `referencia/hermes-agent/AGENTS.md` — discipline geral
- `.claude/knowledge-base/hermes-deep-dive/10-state-persistence.md:157-176` — AD-5 documentado
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:100-110` — lista de sites
- PRs: #3800 (config.yaml), #954 (.env), #146 (cron jobs.json), #4318 (zip-slip validation)
