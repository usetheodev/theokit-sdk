/**
 * M95 Fase 1 — o lease de escritor único ganha semântica de obsolescência.
 *
 * O lock era um `openSync(path, "wx")` cru: exclusividade vinda do filesystem, e **nenhuma** forma
 * de saber se o dono ainda existe. Uma TUI que morreu por `SIGKILL` — ou por queda do terminal —
 * deixava o `.lock` para trás e trancava o usuário para fora da própria sessão, **permanentemente**,
 * sem caminho de recuperação documentado.
 *
 * ADR-2: reclamar por `pid` tem falso positivo entre máquinas (o mesmo número existe noutro host).
 * A reclamação exige `hostname` **e** `pid`; entre hosts diferentes só a janela de heartbeat vale,
 * porque é o único sinal que não mente.
 */

import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireSessionWriter,
  JANELA_DE_HEARTBEAT_MS,
  SessionBusyError,
} from "../src/internal/persistence/session-writer.js";

const criados: Array<{ release: () => Promise<void> }> = [];
afterEach(async () => {
  for (const l of criados.splice(0)) await l.release();
});

const novoCaminho = (): string => join(mkdtempSync(join(tmpdir(), "m95-lease-")), "s.jsonl");

/** Escreve um `.lock` com dono arbitrário, simulando um processo que morreu. */
function lockDe(path: string, dono: { pid: number; hostname: string; mtime: number }): void {
  writeFileSync(`${path}.writer.lock`, JSON.stringify(dono));
}

describe("M95 — o lock diz quem é o dono", () => {
  it("grava pid, hostname e mtime", async () => {
    const p = novoCaminho();
    criados.push(await acquireSessionWriter(p));
    const dono = JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")) as Record<string, unknown>;
    expect(dono.pid).toBe(process.pid);
    expect(dono.hostname).toBe(hostname());
    expect(typeof dono.mtime).toBe("number");
  });
});

describe("M95 — quando um lock é reclamável", () => {
  it("processo MORTO no mesmo host → reclamável", async () => {
    const p = novoCaminho();
    // PID 2^22 + 1 está acima de /proc/sys/kernel/pid_max em qualquer Linux padrão: não existe.
    lockDe(p, { pid: 4_194_305, hostname: hostname(), mtime: Date.now() });
    criados.push(await acquireSessionWriter(p));
    expect(JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")).pid).toBe(process.pid);
  });

  it("OUTRO processo vivo no mesmo host → NÃO reclamável", async () => {
    const p = novoCaminho();
    // O pid do processo pai existe e não é o nosso — um dono vivo e alheio.
    lockDe(p, { pid: process.ppid, hostname: hostname(), mtime: Date.now() });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("o PRÓPRIO processo NÃO re-adquire — o primitivo é estrito", async () => {
    // "Um lease que deixasse as duas passarem seria decorativo" — o teste do M81 diz isso com
    // todas as letras, e está certo. A primeira versão do M95 abriu exceção para o próprio pid
    // para acomodar dois stores num processo, e com isso reprovou os três testes do M81.
    //
    // A conciliação certa não é afrouxar o primitivo: é o CONSUMIDOR contar referências. Quem faz
    // isso é `adquirirCompartilhado` em `fs-session-store.ts` — um lease por caminho por processo,
    // com o último a soltar liberando de fato. Cross-process segue estrito.
    const p = novoCaminho();
    lockDe(p, { pid: process.pid, hostname: hostname(), mtime: Date.now() });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("outro host, lock RECENTE → NÃO reclamável (o pid de lá não diz nada aqui)", async () => {
    const p = novoCaminho();
    lockDe(p, { pid: 4_194_305, hostname: "outra-maquina", mtime: Date.now() });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("outro host, lock VELHO → reclamável pela janela", async () => {
    const p = novoCaminho();
    lockDe(p, {
      pid: 4_194_305,
      hostname: "outra-maquina",
      mtime: Date.now() - JANELA_DE_HEARTBEAT_MS - 1_000,
    });
    criados.push(await acquireSessionWriter(p));
    expect(JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")).hostname).toBe(hostname());
  });

  it("lock CORROMPIDO é tratado como obsoleto — JSON ilegível não tranca para sempre", async () => {
    const p = novoCaminho();
    writeFileSync(`${p}.writer.lock`, "{ isto não é json");
    criados.push(await acquireSessionWriter(p));
    expect(JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")).pid).toBe(process.pid);
  });

  it("release remove o lock", async () => {
    const p = novoCaminho();
    const lease = await acquireSessionWriter(p);
    await lease.release();
    // Depois do release, outro adquire sem erro — a prova de que o lock saiu.
    criados.push(await acquireSessionWriter(p));
  });
});

describe("M95 — um dono VIVO nunca perde o lease por idade", () => {
  it("lock antigo de processo vivo no MESMO host NÃO é reclamável", async () => {
    // O `mtime` é gravado na AQUISIÇÃO e não é tocado a cada append. Com a janela valendo também
    // no mesmo host, qualquer sessão que durasse mais que ela — isto é, toda sessão real — podia
    // ser roubada por outro processo. No mesmo host o `pid` é autoritativo: ou o processo existe,
    // ou não existe. A idade não acrescenta informação, só um modo de falhar.
    const p = novoCaminho();
    lockDe(p, {
      pid: process.ppid,
      hostname: hostname(),
      mtime: Date.now() - JANELA_DE_HEARTBEAT_MS * 10,
    });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });
});

describe("M95/LOW-1 — o lock não pode ser forjado por outro usuário", () => {
  it("nasce 0600 — com 0664 outro usuário do grupo sobrescreveria e forjaria posse", async () => {
    const p = novoCaminho();
    criados.push(await acquireSessionWriter(p));
    expect(statSync(`${p}.writer.lock`).mode & 0o077).toBe(0);
  });
});
