---
'@theokit/sdk': minor
---

**Um erro transitório de provider deixa de destruir o turno inteiro.**

Três defeitos que, combinados, tornavam a perda total:

- **O caminho de chave única não tinha retry.** `buildPoolOrSingle` dava `PoolAwareLlmClient` — circuit
  breaker, backoff de jitter total, `Retry-After`, rotação — com **≥ 2** chaves, e o transporte **cru**
  com uma. Um consumidor que resolve exatamente uma credencial (o caso comum) caía sempre no braço sem
  resiliência. A assimetria não tem justificativa de domínio: **um pool de 1 chave é um pool de tamanho
  1**. `RetryingLlmClient` é composição — `computeBackoffMs` e `sleepWithAbort` já eram módulos
  independentes — e aplica-se aos **três** braços (o do pool ambiente também estava de fora).

- **O caminho de erro não persistia nada.** O `catch` de `run.wait()` chamava `flushSessionWrites()` e
  retornava; `persistTurnToTranscript` é chamado só depois, e é o único chamador do repositório. O
  flush drenava um conjunto **vazio**. Agora persiste o **parcial** — user + tool calls concluídas —
  sem reconstruir o que não aconteceu.

- **`appendRecords` reescrevia o arquivo inteiro por turno.** O(n) de I/O **e** de parse a cada turno,
  O(n²) por sessão. Correto porque o formato **já é append-only** (o DAG de `parentUuid` não depende da
  ordem de linha), e `appendJsonl` **já existia** no pacote com um único chamador. O `withFileLock`
  permanece — é ele que serializa appends concorrentes.

Só erro **transitório** reexecuta: 402 (billing) não é, porque cota não se resolve em milissegundos, e
401 falha na primeira. Teto de 3 tentativas, ciente de `AbortSignal`.
