import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import { transcriptPath } from "../src/internal/persistence/session-transcript.js";

/**
 * M93 T4.1 — `appendRecords` acrescenta o delta em vez de reescrever o arquivo.
 *
 * Antes era `readTranscript` + `writeTranscript` do arquivo **inteiro**, por turno: O(n) de I/O **e**
 * de parse a cada turno, O(n²) por sessão. A nota do consumidor registra 1,4 MB / 3000 linhas em 200
 * turnos.
 *
 * Correto porque o formato **já é append-only** — o DAG de `parentUuid` não depende da ordem de linha.
 * E `appendJsonl` **já existia no pacote**, com um único chamador; a primitiva estava lá e o store a
 * ignorava.
 */
const reg = (id: string) => ({ uuid: id, type: "user", message: { role: "user", content: id } });

const montar = () => {
  const base = mkdtempSync(join(tmpdir(), "m93-"));
  const cwd = base;
  const store = new FsSessionStore({ baseDir: base, cwd });
  const caminho = transcriptPath(base, cwd, "ag-1");
  const linhas = (): number => {
    try {
      return readFileSync(caminho, "utf8").split("\n").filter((l) => l !== "").length;
    } catch {
      return 0;
    }
  };
  return { store, caminho, linhas };
};

describe("M93 — append incremental", () => {
  it("o arquivo cresce EXATAMENTE pelo delta", async () => {
    const { store, linhas } = montar();
    await store.appendRecords("ag-1", [reg("a"), reg("b")] as never);
    const depoisDe2 = linhas();
    await store.appendRecords("ag-1", [reg("c"), reg("d"), reg("e")] as never);
    expect(linhas() - depoisDe2).toBe(3);
  });

  it("a releitura devolve tudo o que foi acrescentado, na ordem", async () => {
    const { store } = montar();
    await store.appendRecords("ag-1", [reg("a"), reg("b")] as never);
    await store.appendRecords("ag-1", [reg("c")] as never);
    const relido = (await store.readRecords("ag-1")) as { uuid: string }[];
    expect(relido.map((r) => r.uuid)).toEqual(["a", "b", "c"]);
  });

  it("appends CONSECUTIVOS nao duplicam nem perdem registro", async () => {
    const { store, linhas } = montar();
    for (let i = 0; i < 3; i++) {
      await store.appendRecords("ag-1", [reg(`x${i}`), reg(`y${i}`)] as never);
    }
    expect(linhas()).toBe(6);
  });

  it("delta VAZIO nao toca o arquivo", async () => {
    const { store, caminho } = montar();
    await store.appendRecords("ag-1", [reg("a")] as never);
    const antes = statSync(caminho).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));
    await store.appendRecords("ag-1", [] as never);
    expect(statSync(caminho).mtimeMs).toBe(antes);
  });

  /**
   * A guarda de delta vazio evita o **lock**, e é isso que a torna observável.
   *
   * A primeira versão do teste acima assere só o `mtime` — e o mutante que remove a guarda
   * **sobrevivia**, porque com `records` vazio o laço não escreve nada de qualquer jeito. O que a
   * guarda de fato evita é `mkdir` + `withFileLock`, e o lock deixa rastro: um arquivo companheiro
   * `<path>.lock`. Sem esse detalhe, a guarda seria uma otimização sem prova.
   */
  it("delta VAZIO nao chega a pegar o lock — a guarda evita mkdir + withFileLock", async () => {
    const base = mkdtempSync(join(tmpdir(), "m93-lock-"));
    const store = new FsSessionStore({ baseDir: base, cwd: base });
    await store.appendRecords("ag-vazio", [] as never);
    const caminho = transcriptPath(base, base, "ag-vazio");
    const criouLock = existsSync(`${caminho}.lock`);
    const criouDir = existsSync(dirname(caminho));
    expect(criouLock || criouDir).toBe(false);
  });

  /**
   * **atomic-counter invariant**: dois `appendRecords` concorrentes de 3 e 4 registros produzem
   * exatamente 7 linhas — nenhuma perdida, nenhuma duplicada. `withFileLock` permanece e é o que
   * serializa; trocar a operação não pode afrouxar isso.
   */
  it("dois appendRecords CONCORRENTES nao perdem linha — o lock permanece", async () => {
    const { store, linhas } = montar();
    await Promise.all([
      store.appendRecords("ag-1", [reg("a"), reg("b"), reg("c")] as never),
      store.appendRecords("ag-1", [reg("d"), reg("e"), reg("f"), reg("g")] as never),
    ]);
    expect(linhas()).toBe(7);
  });

  it("a releitura apos append CONCORRENTE devolve os 7, sem linha partida", async () => {
    const { store } = montar();
    await Promise.all([
      store.appendRecords("ag-1", [reg("a"), reg("b"), reg("c")] as never),
      store.appendRecords("ag-1", [reg("d"), reg("e"), reg("f"), reg("g")] as never),
    ]);
    const relido = (await store.readRecords("ag-1")) as { uuid: string }[];
    expect(relido).toHaveLength(7);
  });
});
