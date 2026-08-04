/**
 * M95 Fase 2 — o lease é de fato **ligado**.
 *
 * `acquireSessionWriter` existe desde o M81 e tinha **zero** chamadores de produção — medido por
 * grep: só a definição e o re-export em `persistence.ts`. A garantia de escritor único estava
 * escrita e desligada desde o dia em que foi escrita, e o roadmap a registrava como entregue. É a
 * pior forma de dívida: a que se apresenta como cobertura.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import { transcriptPath } from "../src/internal/persistence/session-transcript.js";
import { SessionBusyError } from "../src/internal/persistence/session-writer.js";
import type { SessionRecord } from "../src/types/session-record.js";

const abertos: FsSessionStore[] = [];
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.dispose();
});

const registro = (uuid: string): SessionRecord => ({
  type: "user",
  uuid,
  parentUuid: null,
  sessionId: "s",
  timestamp: new Date(0).toISOString(),
});

function novoStore(baseDir: string): FsSessionStore {
  const s = new FsSessionStore({ baseDir, cwd: "/algum/cwd" });
  abertos.push(s);
  return s;
}

describe("M95 — o lease está ligado", () => {
  it("acquire() toma o lease", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = novoStore(base);
    await store.acquire("ag");
    expect(existsSync(`${transcriptPath(base, "/algum/cwd", "ag")}.writer.lock`)).toBe(true);
  });

  it("appendRecords NUNCA lança SessionBusyError — o turno não some em silêncio", async () => {
    // BLOCKER-1 da revisão adversarial. O contrato de `SessionStore` diz que rejeição de append é
    // best-effort: "logged to stderr, NOT thrown to the caller". Adquirir o lease ali fazia o
    // SessionBusyError ser ENGOLIDO, e o perdedor perdia o turno inteiro sem nada em disco e sem
    // como reagir — pior que o problema original, que era intercalar linhas.
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const path = transcriptPath(base, "/algum/cwd", "ag");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      `${path}.writer.lock`,
      JSON.stringify({ pid: process.ppid, hostname: hostname(), mtime: Date.now() }),
    );
    const store = novoStore(base);
    await expect(store.appendRecords("ag", [registro("b")])).resolves.toBeUndefined();
  });

  it("dispose libera o lease", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = new FsSessionStore({ baseDir: base, cwd: "/algum/cwd" });
    await store.acquire("ag");
    await store.dispose();
    expect(existsSync(`${transcriptPath(base, "/algum/cwd", "ag")}.writer.lock`)).toBe(false);
  });

  it("um OUTRO PROCESSO vivo segurando o lock produz SessionBusyError", async () => {
    // O lease protege contra outro PROCESSO — dois stores no MESMO processo são padrão legítimo
    // (os testes golden de compactação fazem isso, e reprovaram quando a primeira versão recusava
    // o próprio dono). Então o dono alheio é simulado pelo pid do processo pai: vivo, e não nós.
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const path = transcriptPath(base, "/algum/cwd", "ag");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      `${path}.writer.lock`,
      JSON.stringify({ pid: process.ppid, hostname: hostname(), mtime: Date.now() }),
    );
    const store = novoStore(base);
    await expect(store.acquire("ag")).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("ler NÃO adquire lease — leitura concorrente continua livre", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = novoStore(base);
    await store.readRecords("ag");
    expect(existsSync(`${transcriptPath(base, "/algum/cwd", "ag")}.writer.lock`)).toBe(false);
  });

  it("dispose é idempotente", async () => {
    const base = mkdtempSync(join(tmpdir(), "m95-ligado-"));
    const store = new FsSessionStore({ baseDir: base, cwd: "/algum/cwd" });
    await store.acquire("ag");
    await store.dispose();
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
