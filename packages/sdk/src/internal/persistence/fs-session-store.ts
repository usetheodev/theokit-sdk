/**
 * SE41 — `FsSessionStore`, the DEFAULT reference implementation of the pluggable
 * {@link SessionStore} seam. It reads and append-writes the native Claude-shaped
 * `.jsonl` transcript at `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl` — the
 * exact on-disk format SE40 introduced (the file the Claude Code CLI can
 * `--continue`). Omitting `local.sessionStore` resolves to this store, so the
 * default persistence path is byte-identical to SE40 behavior.
 *
 * `readRecords` is `readTranscript(transcriptPath(...))` (a missing session →
 * `[]`, not an error — a fresh agent has no history). `appendRecords` is a TRUE
 * append: it reads the prior records, concatenates the new-turn delta, and
 * rewrites the whole line set atomically under the SE40 cross-process file lock
 * (`writeTranscript` never shrinks — the native format is an append-only
 * `parentUuid` DAG). The parent dir is created BEFORE acquiring the lock because
 * the lock's companion `<path>.lock` file needs an existing parent dir (the SE40
 * `mkdir(dirname)`-before-lock fix).
 *
 * @internal
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionStore } from "../../types/session-store.js";
import { withFileLock } from "./file-lock.js";
import { appendJsonl } from "./jsonl.js";
import { readTranscript, type SessionRecord, transcriptPath } from "./session-transcript.js";
import { acquireSessionWriter, type SessionWriterLease } from "./session-writer.js";

/** Options identifying the on-disk transcript location for the FS default store. */
export interface FsSessionStoreOptions {
  /** Transcript base dir (`~/.theokit` default, `~/.claude` for CLI interop) — already `~`-expanded. */
  baseDir: string;
  /** The workspace cwd whose encoded form is the transcript project dir. */
  cwd: string;
}

/**
 * The default `SessionStore` — reads/append-writes the native `.jsonl` transcript.
 *
 * @internal
 */
/**
 * Leases compartilhados por caminho, com contagem de referências.
 *
 * `acquireSessionWriter` é ESTRITO de propósito: duas aquisições concorrentes do mesmo caminho, e
 * exatamente uma vence — "um lease que deixasse as duas passarem seria decorativo" (o teste do M81
 * diz isso com todas as letras, e está certo). Esse é o contrato do primitivo, e ele não muda.
 *
 * Mas dentro de UM processo é normal existir mais de um store sobre a mesma sessão: os testes
 * golden de compactação e de sends concorrentes fazem exatamente isso, e são registro de
 * comportamento real do runtime. Aplicar o primitivo cru ali transformaria um padrão legítimo em
 * `SessionBusyError`.
 *
 * A conciliação é aqui, no consumidor do primitivo: o processo tira UM lease por caminho e conta
 * quantos stores o usam. O último a soltar libera de fato. Cross-process continua estrito — que é o
 * problema que o M81 enuncia ("`exec resume --last` pode escrever na sessão viva da TUI").
 */
const compartilhados = new Map<string, { lease: SessionWriterLease; refs: number }>();

async function adquirirCompartilhado(path: string): Promise<SessionWriterLease> {
  const existente = compartilhados.get(path);
  if (existente !== undefined) {
    existente.refs++;
    return criarProxy(path);
  }
  const lease = await acquireSessionWriter(path);
  compartilhados.set(path, { lease, refs: 1 });
  return criarProxy(path);
}

/** Um handle que decrementa a contagem; o último a soltar libera o lease de verdade. */
function criarProxy(path: string): SessionWriterLease {
  let solto = false;
  return {
    sessionPath: path,
    release: async (): Promise<void> => {
      if (solto) return;
      solto = true;
      const entrada = compartilhados.get(path);
      if (entrada === undefined) return;
      entrada.refs--;
      if (entrada.refs > 0) return;
      compartilhados.delete(path);
      await entrada.lease.release();
    },
  };
}

export class FsSessionStore implements SessionStore {
  readonly #baseDir: string;
  readonly #cwd: string;
  /** Um lease por `agentId` — um store serve mais de uma sessão ao longo da vida do processo. */
  readonly #leases = new Map<string, SessionWriterLease>();

  constructor(options: FsSessionStoreOptions) {
    this.#baseDir = options.baseDir;
    this.#cwd = options.cwd;
  }

  async readRecords(agentId: string): Promise<SessionRecord[]> {
    return readTranscript(transcriptPath(this.#baseDir, this.#cwd, agentId));
  }

  async appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void> {
    // Empty delta → nothing to persist (avoids an unnecessary lock + rewrite).
    if (records.length === 0) return;
    const path = transcriptPath(this.#baseDir, this.#cwd, agentId);
    // mkdir BEFORE the lock: withFileLock's companion `<path>.lock` needs the parent dir.
    await mkdir(dirname(path), { recursive: true });
    // M95 — a garantia de escritor único do M81 finalmente LIGADA. Ela existia como
    // `acquireSessionWriter` e tinha ZERO chamadores de produção desde o dia em que foi escrita;
    // o roadmap a registrava como entregue. Adquirido no primeiro append (leitura segue livre) e
    // solto em `dispose()`.
    if (!this.#leases.has(agentId)) {
      this.#leases.set(agentId, await adquirirCompartilhado(path));
    }
    await withFileLock(path, async () => {
      // M93 — acrescenta o DELTA em vez de reescrever o arquivo inteiro.
      //
      // Antes: `readTranscript` + `writeTranscript` de tudo, por turno. O(n) de I/O **e** de parse a
      // cada turno, O(n²) por sessão — a nota do consumidor em `agents/lib/session/backtrack.ts`
      // registra 1,4 MB / 3000 linhas em 200 turnos.
      //
      // Correto porque o formato **já é append-only**: o DAG de `parentUuid` não depende da ordem de
      // linha, e cada registro carrega o próprio pai. `appendJsonl` **já existia no pacote** e tinha um
      // único chamador (`eval/runner.ts`) — a primitiva estava lá, o store é que a ignorava (rung 4).
      //
      // O `withFileLock` permanece — mas a afirmação anterior de que "ele é o que serializa dois
      // `appendRecords` concorrentes" era forte demais, e a revisão adversarial do M93 mediu isso:
      // removê-lo não reprova nenhum teste. A razão é o próprio parágrafo acima — o DAG de
      // `parentUuid` não depende da ordem de linha, então dois lotes intercalados reconstroem igual.
      // O trabalho que o lock fazia (proteger um read-modify-write) sumiu junto com o rewrite.
      //
      // O que ele ainda cobre é a janela TOCTOU de `precisaDeQuebraAntes` (ler o último byte, depois
      // escrever): sem ele, dois processos podem ambos concluir "falta \n" e produzir uma linha em
      // branco — que o leitor descarta, isto é, benigno. Fica como **defesa declarada, não
      // mecanizada** (a disciplina de `error-handling.md § 4`: enumerar o resíduo em vez de deixar a
      // ausência de teste passar por cobertura).
      //
      // `writeTranscript` continua existindo para **compactação**, a única operação que legitimamente
      // reescreve o arquivo.
      for (const record of records) appendJsonl(path, record);
    });
  }

  /**
   * Solta todo lease que este store detém.
   *
   * Sem isto o `.writer.lock` sobrevive ao processo e a próxima abertura teria de esperar a janela
   * de heartbeat — recuperável, mas 30 s de espera para um encerramento LIMPO seria um defeito
   * evitável. Idempotente: chamar duas vezes não é erro.
   */
  async dispose(): Promise<void> {
    const leases = [...this.#leases.values()];
    this.#leases.clear();
    for (const lease of leases) await lease.release();
  }
}
