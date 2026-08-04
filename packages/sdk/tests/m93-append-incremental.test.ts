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
 * of parsing on every turn, O(n^2) per session. The consumer note records 1.4 MB / 3000 lines over 200
 * turnos.
 *
 * Correct because the format **is already append-only** — the `parentUuid` DAG does not depend on line order.
 * And `appendJsonl` **already existed in the package**, with a single caller; the primitive was there and the store
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
      return readFileSync(caminho, "utf8")
        .split("\n")
        .filter((l) => l !== "").length;
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
   * The empty-delta guard avoids the **lock**, and that is what makes it observable.
   *
   * The first version of the test above asserted only `mtime` — and the mutant removing the guard
   * **survived**, because with an empty `records` the loop writes nothing anyway. What the
   * guard actually avoids is `mkdir` + `withFileLock`, and the lock leaves a trace: a companion file
   * `<path>.lock`. Without that detail, the guard would be an optimization without proof.
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
   * exactly 7 lines — none lost, none duplicated. `withFileLock` stays and is what
   * serializes; swapping the operation must not loosen that.
   */
  // NOTE (M93 adversarial review): this test does NOT prove the lock is necessary — removing it
  // leaves the suite green, because `appendJsonl` is synchronous and the `parentUuid` DAG makes
  // interleaving safe. What it proves is the invariant that matters: no line is lost under
  // concurrency. The defense the lock still offers is declared in `fs-session-store.ts` as
  // non-mechanized residue, rather than claimed here as coverage.
  it("dois appendRecords CONCORRENTES nao perdem linha", async () => {
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
