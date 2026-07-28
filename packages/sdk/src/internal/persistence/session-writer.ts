/**
 * M81 — single-writer lease for a session transcript.
 *
 * ## The problem
 *
 * Nothing stops two processes appending to the same JSONL transcript. The concrete case: `exec
 * resume --last` can write into the TUI's live session. Two interleaved appends to an append-only
 * file produce lines that are each individually valid and whose SEQUENCE is fiction — and nothing
 * reports it, because every line parses.
 *
 * ## Why an exclusive lockfile rather than `withFileLock`
 *
 * The plan's ADR D2 said to compose `withFileLock`, and that was the right instinct — do not build a
 * second lock mechanism. It turned out not to fit the SHAPE: `withFileLock(path, fn)` is
 * scope-based — it holds the lock for the duration of a callback. A session lease is **held across
 * turns**, for as long as the process owns the session, with an explicit `release()`. Wrapping the
 * whole session lifetime in a callback would invert control of the entire agent loop.
 *
 * So this uses the same underlying primitive `withFileLock` uses (an exclusive-create lockfile,
 * `wx`) with lease semantics on top. That keeps the mechanism single — the file-existence lock —
 * while giving it the lifetime the caller needs. The deviation from D2 is recorded here because the
 * plan's rationale (no second mechanism) still holds; only its shape assumption did not.
 *
 * ## Fail fast, never wait
 *
 * A second writer that WAITED would block `exec` behind a TUI session that can last hours. The typed
 * error lets the caller choose: fork to a new id, or give up with a real diagnosis.
 *
 * @internal
 */

import { closeSync, fchmodSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { hostname } from "node:os";

import { TheokitAgentError } from "../../errors.js";

/**
 * M81 — another process already holds the writer lease for this session.
 *
 * Carries `sessionPath` because knowing WHICH session is busy is what lets the caller decide between
 * forking and waiting for the user to close the TUI (`rules/error-handling.md § 2` — context enough
 * to act on).
 */
export class SessionBusyError extends TheokitAgentError {
  override readonly name = "SessionBusyError";

  constructor(readonly sessionPath: string) {
    super(
      `another process is already writing this session: ${sessionPath}. ` +
        "Fork it to a new id instead of appending — two writers interleave lines into a sequence " +
        "that parses but is not what either process wrote.",
      { code: "session_busy", isRetryable: false },
    );
  }
}

/** A held writer lease. `release()` is idempotent. */
export interface SessionWriterLease {
  readonly sessionPath: string;
  release(): Promise<void>;
}

/**
 * Take the exclusive writer lease for `sessionPath`, or reject with {@link SessionBusyError}.
 *
 * The lock is a sibling `.lock` file created with `wx` — the same file-existence primitive the
 * SDK's `withFileLock` builds on. Exclusivity comes from the filesystem, so it holds across
 * processes, not just across async tasks in one process.
 */
/**
 * Janela de obsolescência **entre máquinas** — e só entre elas.
 *
 * 30 s a partir da AQUISIÇÃO. O nome "heartbeat" seria mentira: o registro é gravado uma vez, na
 * tomada do lease, e **não** é renovado a cada escrita. A versão anterior deste comentário dizia
 * "o dono toca o arquivo a cada aquisição, então um processo ativo nunca cruza a janela" — falso
 * duas vezes, e a revisão adversarial mediu as duas.
 *
 * No **mesmo host** isso não importa: `reclamavel` decide pelo `pid`, que é exato, e a idade não
 * entra na conta. Entre hosts, importa e é um limite real: um dono remoto **vivo** perde o lease
 * depois de 30 s, porque não há como perguntar a outra máquina se o processo dela existe.
 *
 * **Resíduo declarado, não mecanizado** (a disciplina de `error-handling.md § 4`): renovar o
 * registro a cada append fecharia essa janela, ao custo de um `write` por turno num arquivo que
 * hoje é escrito uma vez por sessão. Não foi feito, e o caso multi-host não é o que motiva este
 * milestone — o enunciado é `exec` e TUI na mesma máquina.
 */
export const JANELA_DE_HEARTBEAT_MS = 30_000;

/** Quem detém o lock. Gravado como JSON no `.writer.lock`. */
interface DonoDoLock {
  pid: number;
  hostname: string;
  mtime: number;
}

/**
 * Grava o dono com permissão restrita ao usuário.
 *
 * `0600` porque o lock é uma afirmação de POSSE: com o `0664` que o umask usual produz, outro
 * usuário do mesmo grupo pode sobrescrever o arquivo e forjar a posse da sessão — e a partir daí o
 * dono legítimo é quem passa a receber `SessionBusyError`. O conteúdo (`pid`, `hostname`) é de
 * baixa sensibilidade; o que a permissão protege é a **integridade** do sinal, não o sigilo dele.
 */
function gravarDono(lockPath: string, dono: DonoDoLock): void {
  const fd = openSync(lockPath, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(dono));
    // O `mode` do `open` só vale na CRIAÇÃO. Um `.writer.lock` herdado de uma versão anterior — ou
    // deixado por um processo com umask diferente — continuaria `0664` depois de reclamado, e a
    // janela de forja que o modo fecha para locks novos seguiria aberta para os antigos.
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
}

/** Lê o dono do lock. `undefined` quando o arquivo sumiu ou o conteúdo é ilegível. */
function lerDono(lockPath: string): DonoDoLock | undefined {
  let bruto: string;
  try {
    bruto = readFileSync(lockPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // `ENOENT` — sumiu entre o `EEXIST` e a leitura. Corrida benigna: o lock não existe mais.
    if (code === "ENOENT") return undefined;
    // Qualquer outra falha de leitura (`EACCES` num diretório compartilhado, `EIO`) é diferente em
    // espécie: o lock **existe** e nós é que não conseguimos ler o dono. Tratar como livre faria
    // dois escritores conviverem — precisamente o que o lease existe para impedir —, e o `0600`
    // que protege o lock contra forja AMPLIA essa superfície: num diretório compartilhado, o lock
    // do outro usuário é ilegível por desenho.
    //
    // Não saber quem é o dono não é o mesmo que não haver dono. Fail-closed.
    throw new SessionBusyError(lockPath.replace(/\.writer\.lock$/, ""));
  }
  try {
    const d = JSON.parse(bruto) as Partial<DonoDoLock>;
    if (
      typeof d.pid !== "number" ||
      typeof d.hostname !== "string" ||
      typeof d.mtime !== "number"
    ) {
      return undefined;
    }
    return { pid: d.pid, hostname: d.hostname, mtime: d.mtime };
  } catch {
    // JSON ilegível: um lock que ninguém consegue interpretar não pode trancar a sessão para
    // sempre. Tratar como obsoleto é a escolha recuperável; o custo é o mesmo de um lock velho.
    return undefined;
  }
}

/** O processo existe? `signal 0` não envia nada — só consulta permissão/existência. */
function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM significa que ele EXISTE e é de outro usuário.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * O lock pode ser tomado de quem o detém?
 *
 * ADR-2 do plano: reclamar por `pid` sozinho tem falso positivo entre máquinas — o mesmo número
 * existe noutro host, apontando para um processo sem relação. Então:
 *
 * - **mesmo host:** o `pid` é autoritativo, e **só** ele. Processo morto ⇒ reclamável na hora;
 *   processo vivo ⇒ nunca, por mais velho que o lock esteja.
 * - **outro host:** o `pid` não diz nada aqui. Só a janela de heartbeat vale, porque é o único
 *   sinal que não mente entre máquinas.
 *
 * ## Por que a idade NÃO conta no mesmo host
 *
 * A primeira versão fazia `velho || !processoVivo(pid)`, e isso era um defeito grave: o `mtime` é
 * gravado na **aquisição** e não é tocado a cada append, então qualquer sessão que durasse mais que
 * a janela — isto é, **toda sessão real** — passava a ser roubável por outro processo. Dois
 * escritores no mesmo transcript é exatamente o que o lease existe para impedir.
 *
 * No mesmo host a pergunta "o dono ainda existe?" tem resposta exata, e a idade não acrescenta
 * informação nenhuma a ela — só um modo de errar. Manter a janela ali seria heurística por cima de
 * um fato.
 */
function reclamavel(dono: DonoDoLock | undefined): boolean {
  if (dono === undefined) return true; // ilegível ou sumido
  if (dono.hostname !== hostname()) {
    return Date.now() - dono.mtime > JANELA_DE_HEARTBEAT_MS;
  }
  return !processoVivo(dono.pid);
}

export async function acquireSessionWriter(sessionPath: string): Promise<SessionWriterLease> {
  // M95 — `.writer.lock`, NÃO `.lock`.
  //
  // `withFileLock(path, fn)` já usa `<path>.lock` como companheiro. Enquanto o lease não era
  // chamado de lugar nenhum (o defeito que este milestone corrige) a colisão era teórica; ligá-lo
  // ao mesmo arquivo faria o lease de vida longa bloquear toda seção crítica curta do mesmo path.
  //
  // Dois arquivos porque são duas coisas: `withFileLock` protege uma seção com início e fim; o
  // lease é POSSE, mantida através de turnos, com `release()` explícito — a distinção que o
  // docstring do M81 acima já explica.
  const lockPath = `${sessionPath}.writer.lock`;
  const meu: DonoDoLock = { pid: process.pid, hostname: hostname(), mtime: Date.now() };
  let fd: number;
  try {
    // O modo vale na CRIAÇÃO — o `w` de `gravarDono` não altera arquivo existente.
    fd = openSync(lockPath, "wx", 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // M95 — o lock existe. Até aqui isso bastava para recusar, e era o defeito: uma TUI morta por
    // SIGKILL trancava o usuário para fora da própria sessão PERMANENTEMENTE, sem caminho de
    // recuperação documentado. Agora o lock diz quem é o dono, e um dono morto cede o lugar.
    if (!reclamavel(lerDono(lockPath))) throw new SessionBusyError(sessionPath);
    gravarDono(lockPath, meu);
    return criarLease(sessionPath, lockPath);
  }
  closeSync(fd);
  gravarDono(lockPath, meu);

  return criarLease(sessionPath, lockPath);
}

/** O lease em si — `release()` idempotente. Extraído porque a aquisição tem dois caminhos de saída. */
function criarLease(sessionPath: string, lockPath: string): SessionWriterLease {
  let released = false;
  return {
    sessionPath,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      rmSync(lockPath, { force: true });
    },
  };
}
