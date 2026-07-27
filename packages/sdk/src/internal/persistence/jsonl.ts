/**
 * Durable JSONL primitives shared by the eval harness (M6).
 *
 * - `loadJsonl` — generic dataset reader (split/trim/skip-blank/parse) with a
 *   line-numbered {@link JsonlParseError}. The dataset SCHEMA is the caller's
 *   concern via `map` (M6 ADR D3) — this module owns only the parse.
 * - `appendJsonl` / `readJsonlIds` — crash-durable, resumable batch persistence
 *   (M6 ADR D1): each record is appended as one whole `\n`-terminated line the
 *   instant it is produced, and a re-run resumes by skipping already-keyed rows.
 *
 * referencia: knowledge-base/references/theocode-eval/lib/swebench-dataset.ts:82
 * (parseJsonl + line-N error) and swebench-batch.ts:113,205 (resume + per-line
 * flush).
 *
 * @internal
 */
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** Raised when a JSONL line is not valid JSON or is not a JSON object. Carries the 1-based line number. */
export class JsonlParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "JsonlParseError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a single trimmed line to a plain object, or `undefined` if blank / invalid / non-object. */
function tryParseObjectLine(line: string): Record<string, unknown> | undefined {
  if (line.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isPlainObject(parsed) ? parsed : undefined;
}

/**
 * Parse a JSONL file into rows. Blank lines are skipped. A malformed or
 * non-object line throws {@link JsonlParseError} naming the 1-based line. When
 * `map` is provided, each raw object is mapped to the typed row (the SWE-bench
 * schema lives in the caller's `map`, per M6 ADR D3).
 */
export function loadJsonl<T = Record<string, unknown>>(
  path: string,
  opts: {
    map?: (raw: Record<string, unknown>, lineNumber: number) => T;
    /**
     * M81 — tolerate a truncated LAST line (a crash artifact: the process died mid-write).
     *
     * Opt-in on purpose. As a default it would also swallow corruption in the MIDDLE of the file,
     * turning loud data loss into silent data loss — the wrong trade for a session store.
     */
    tolerateTrailingPartialLine?: boolean;
  } = {},
): T[] {
  const linhas = readFileSync(path, "utf8").split("\n");
  const out: T[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const lineNumber = i + 1;
    const line = (linhas[i] ?? "").trim();
    if (line.length === 0) continue;
    // M81 — `undefined` = linha inválida tolerada (última, truncada por crash). Qualquer outra
    // linha inválida já lançou dentro de `parsearLinha`.
    const parsed = parsearLinha(
      line,
      lineNumber,
      opts.tolerateTrailingPartialLine === true && lineNumber === linhas.length,
    );
    if (parsed === undefined) break;
    out.push(opts.map ? opts.map(parsed, lineNumber) : (parsed as unknown as T));
  }
  return out;
}

/**
 * Parse de UMA linha, devolvendo `undefined` quando ela é uma última-linha-truncada tolerada.
 *
 * Extraído porque `loadJsonl` passou do teto de complexidade cognitiva quando ganhou a tolerância —
 * e porque parse-de-linha e iteração-do-arquivo são duas responsabilidades que só estavam juntas
 * por hábito.
 */
function parsearLinha(
  line: string,
  lineNumber: number,
  tolerar: boolean,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    if (tolerar) return undefined;
    throw new JsonlParseError(`line ${lineNumber}: invalid JSON`, lineNumber);
  }
  if (!isPlainObject(parsed)) {
    throw new JsonlParseError(`line ${lineNumber}: not a JSON object`, lineNumber);
  }
  return parsed;
}

/**
 * Append one record as a whole `\n`-terminated JSON line. Creates the parent dir
 * if missing. `appendFileSync` is synchronous, so within a single Node process
 * the event loop serializes writes and each call writes its line atomically —
 * interleave-safe for the bounded-concurrency batch runner.
 *
 * referencia: swebench-batch.ts:192 (mkdir-before-append), :205 (per-line flush).
 */
export function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const prefixo = precisaDeQuebraAntes(path) ? "\n" : "";
  // M93 (revisão adversarial, H1) — `0o600`. `appendFileSync` não aceita `mode`, então a permissão
  // vinha do umask: sob `umask 022` o transcript nascia `0664`, world-readable. O caminho anterior
  // (`replaceFileAtomic`) fixava `0o600` de propósito — "holds the FULL in-flight content
  // (credential snapshots, OAuth tokens)" (`atomic-write.ts:107`) — e trocar para append perdeu isso
  // em silêncio. A mesma classe já havia sido pega no consumidor (`atomic-sync.ts`, M88 HIGH-1).
  //
  // `mode` só vale na CRIAÇÃO; um arquivo pré-existente mantém a permissão que já tem.
  const fd = openSync(path, "a", 0o600);
  try {
    writeSync(fd, `${prefixo}${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
}

/**
 * O arquivo termina sem `\n`? Então a última linha está truncada — um crash no meio de um append.
 *
 * Sem esta checagem o append seguinte **cola** no meio da linha partida, produzindo uma linha
 * inválida que o leitor descarta: o registro NOVO some junto com o parcial. O caminho anterior
 * (read-modify-write) se auto-curava disso porque reescrevia o arquivo inteiro. Medido na revisão
 * adversarial do M93 (H2): após um append sobre arquivo truncado, o registro recém-escrito não era
 * mais legível.
 *
 * Lê **um byte**, não o arquivo.
 */
function precisaDeQuebraAntes(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return false; // arquivo ainda não existe: nada a emendar
  }
  try {
    const tamanho = fstatSync(fd).size;
    if (tamanho === 0) return false;
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, tamanho - 1);
    return buf[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * Read the set of keys from an existing JSONL file for which `keyFn(parsed)`
 * returns a non-empty string. Used to resume a crashed batch by skipping rows
 * already persisted with a successful result. A trailing partial line from an
 * interrupted append is tolerated (skipped, not thrown), and a missing file
 * yields an empty set.
 *
 * referencia: swebench-batch.ts:113 (readDoneIds), :129 (success-only),
 * :131 (tolerate partial line).
 */
export function readJsonlIds(
  path: string,
  keyFn: (parsed: Record<string, unknown>) => string | undefined,
): Set<string> {
  const done = new Set<string>();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return done; // no file yet → nothing done
  }
  for (const rawLine of text.split("\n")) {
    // A trailing partial line from an interrupted run parses to undefined → skipped.
    const parsed = tryParseObjectLine(rawLine.trim());
    if (parsed === undefined) continue;
    const key = keyFn(parsed);
    if (typeof key === "string" && key.length > 0) done.add(key);
  }
  return done;
}
