import { randomBytes } from "node:crypto";
import { mkdir, open, rename, statfs, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { diag } from "../diagnostics.js";

// T5.8 — Linux filesystem magic numbers (from `<linux/magic.h>`).
// Used by `detectNetworkFsName` to identify the parent directory's
// filesystem type from a `statfs()` return value. The four entries
// below cover the network/FUSE cases where `rename()` is best-effort
// rather than strictly atomic; everything else is treated as local.
const NETWORK_FS_MAGIC: ReadonlyMap<number, string> = new Map([
  [0x6969, "nfs"],
  [0x517b, "smb"],
  [0xff534d42, "cifs"],
  [0x65735546, "fuse"],
]);

/**
 * T5.8 — Map a `statfs().type` magic number to a network-FS label, or
 * `null` for local filesystems. Pure function — exported via the
 * `__TESTING__` seam so unit tests can drive the parse logic without
 * needing a network mount.
 *
 * @internal
 */
function detectNetworkFsName(typeMagic: number): string | null {
  return NETWORK_FS_MAGIC.get(typeMagic) ?? null;
}

const warnedNfsDirs = new Set<string>();

/**
 * T5.8 — Best-effort one-shot stderr warning when `dirPath` lives on a
 * network/FUSE filesystem. Silent no-op on local filesystems, on
 * statfs failure (Windows / Node < 18.15 / EACCES), or after the
 * first warning per (dir + label) pair. Mirrors the `sqlite-wal.ts`
 * warn-once-per-label pattern (D63).
 *
 * @internal
 */
async function warnOnNetworkFsOnce(dirPath: string, label: string): Promise<void> {
  const key = `${dirPath}\0${label}`;
  if (warnedNfsDirs.has(key)) return;
  warnedNfsDirs.add(key);
  try {
    const info = await statfs(dirPath);
    const fsName = detectNetworkFsName(info.type);
    if (fsName === null) return;
    diag(
      `[theokit-sdk] ${label}: detected network fs (${fsName}) at ${dirPath} — ` +
        "rename() atomicity guarantees may be weaker than expected.\n",
    );
  } catch {
    // statfs unavailable (Windows / Node < 18.15) or unreadable —
    // silent fallback. The warning is purely informational.
  }
}

/**
 * T5.8 — Test seam exposing the pure detection function so unit tests
 * can assert magic-number coverage without spinning up a network FS.
 * NOT included in the public barrel.
 *
 * @internal
 */
export function __TESTING__detectNetworkFsName(typeMagic: number): string | null {
  return detectNetworkFsName(typeMagic);
}

/**
 * T5.8 — Test seam: clear the per-directory warn-once registry between
 * tests so warning-emission tests stay deterministic.
 *
 * @internal
 */
export function __TESTING__resetNfsWarnings(): void {
  warnedNfsDirs.clear();
}

/**
 * M107 — controle de criação do temporário, comum a `replaceFileAtomic`,
 * `atomicWriteJson` e `atomicWriteText`.
 *
 * Ambos os campos são OPCIONAIS e o default é byte-idêntico ao comportamento
 * anterior a M107. Ver `replaceFileAtomic` para por que a reafirmação de modo
 * é condicional.
 *
 * @internal
 */
export interface AtomicWriteFileOptions {
  /**
   * Bits de permissão do arquivo criado. Default: `0o600`, o literal fixo de
   * antes — filtrado pelo `umask`, como sempre foi. Quando informado, o modo é
   * reafirmado no descritor, de modo que o `umask` não pode silenciosamente
   * limpar bits que o chamador pediu.
   */
  mode?: number;
  /**
   * Criar o temporário com `wx` (criação exclusiva) em vez de `w`. Default:
   * `false` — a flag de antes. Com `true`, um temporário pré-existente vira
   * `EEXIST` em vez de ser truncado.
   */
  exclusive?: boolean;
}

/**
 * Atomic file replacement: write content to a per-call unique tmp path,
 * fsync, then rename over the target. Crash mid-write leaves either the old
 * file intact or the new file complete — never a half-written file.
 *
 * The tmp suffix is `<pid>.<rand>.tmp` so parallel processes (and concurrent
 * burst writes within one process) never collide on the same tmp path — a
 * race that would manifest as `ENOENT` on `rename` after the rival process
 * already moved its tmp into place.
 *
 * Mirrors peer-project's `replaceFileAtomic` from
 * `referencia/peer-project/packages/memory-host-sdk/src/host/fs-utils.ts` with
 * the multi-writer robustness fix.
 *
 * ## M107 — `options` é opcional, e o default é byte-idêntico
 *
 * O terceiro parâmetro é aditivo: todo chamador anterior continua compilando e
 * escrevendo exatamente o mesmo byte, com o mesmo modo, no mesmo caminho.
 *
 * A reafirmação de modo (`handle.chmod`) é **condicional a `mode !== undefined`**,
 * e isso não é cosmético. O argumento de modo do `open` é filtrado pelo `umask`,
 * que só LIMPA bits — medido nesta base de código antes da mudança:
 *
 * ```
 * umask 0o002  ->  0o600      umask 0o022  ->  0o600      umask 0o200  ->  0o400
 * ```
 *
 * Um `chmod` incondicional levaria o terceiro caso de `0o400` para `0o600` — uma
 * mudança de disco para todo chamador que não pediu nada, incluindo consumidores
 * externos. Quando o chamador PEDE um modo, porém, deixar o `umask` decidir em
 * silêncio é o defeito que este parâmetro existe para fechar; daí a reafirmação.
 *
 * Ela vai no DESCRITOR, antes do `rename`, nunca depois: dar `chmod` no arquivo
 * final deixaria uma janela em que ele está com o modo do `umask` — o anti-padrão
 * de `opencode/packages/core/src/fs-util.ts:110-114`. A forma escolhida (modo como
 * argumento do `open`) é a de `codex-rs/network-proxy/src/certs.rs:687,783-791`.
 *
 * @internal
 */
export async function replaceFileAtomic(
  filePath: string,
  content: string,
  options?: AtomicWriteFileOptions,
): Promise<void> {
  // T5.8 — warn once per parent directory if it lives on a network /
  // FUSE filesystem where `rename()` atomicity is best-effort. The
  // write proceeds unchanged; the warning is purely informational so
  // operators can spot the case in stderr / log aggregators.
  await warnOnNetworkFsOnce(dirname(filePath), "atomic-write");
  // T5.7 — crypto-random tmp suffix (CSPRNG, 64 bits of entropy)
  // replaces the predictable `Math.random().toString(36)` source. An
  // attacker observing the process can no longer predict the next
  // tmp path and pre-stage a hostile file to be renamed into place.
  const suffix = randomBytes(8).toString("hex");
  const tmp = `${filePath}.${process.pid}.${suffix}.tmp`;
  // T5.7 — mode 0o600 on the tmp file (owner read+write only). The
  // tmp file holds the FULL in-flight content (credential snapshots,
  // OAuth tokens) before the rename. World-readable default would
  // expose secrets during the ms-window between open and rename
  // (TOCTOU). On modern Linux the post-rename target inherits the
  // tmp's permission bits, so the final file is also 0o600.
  const handle = await open(tmp, options?.exclusive === true ? "wx" : "w", options?.mode ?? 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    // Condicional por medição, não por gosto — ver o docblock desta função.
    if (options?.mode !== undefined) await handle.chmod(options.mode);
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, filePath);
  } catch (cause) {
    // Cleanup tmp on rename failure so we don't leak stale .tmp files.
    await unlink(tmp).catch(() => undefined);
    throw cause;
  }
}

/**
 * Options for `atomicWriteJson`.
 *
 * @internal
 */
export interface AtomicWriteJsonOptions extends AtomicWriteFileOptions {
  /** Indent passed to `JSON.stringify`. Default: 2. */
  indent?: number;
  /** Whether to append a trailing newline (POSIX convention). Default: true. */
  trailingNewline?: boolean;
}

/**
 * Typed JSON atomic write helper.
 *
 * Serializes `data` to JSON, then delegates to `replaceFileAtomic`. The
 * parent directory is auto-created (recursive `mkdir`) to make this helper
 * safe for callers who haven't ensured the directory exists (EC-4 in the
 * persistence-state-hardening plan).
 *
 * Throws `TypeError` on circular refs or `undefined` data (propagates from
 * `JSON.stringify`).
 *
 * @internal
 */
export async function atomicWriteJson<T>(
  filePath: string,
  data: T,
  options?: AtomicWriteJsonOptions,
): Promise<void> {
  const indent = options?.indent ?? 2;
  const trailingNewline = options?.trailingNewline ?? true;
  const json = JSON.stringify(data, null, indent);
  if (json === undefined) {
    throw new TypeError("atomicWriteJson: cannot serialize undefined");
  }
  const content = trailingNewline ? `${json}\n` : json;
  await mkdir(dirname(filePath), { recursive: true });
  await replaceFileAtomic(filePath, content, options);
}

/**
 * Atomic text write. Same crash-safety guarantees as `replaceFileAtomic` +
 * auto-mkdir of the parent directory. Used by `theokit-migrate-config`
 * (T4.1, EC-2 MUST FIX) so a crash mid-migration leaves previous MD files
 * intact rather than corrupting them.
 *
 * @internal
 */
export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await replaceFileAtomic(filePath, content);
}
