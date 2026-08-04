/**
 * Lint test — the codebase is English-only. Bans Portuguese in source and
 * tests: identifiers, comments, JSDoc and string literals alike.
 *
 * Why this is a gate and not a style preference:
 *
 * - JSDoc on an exported symbol is emitted into the published `.d.ts`, so a
 *   Portuguese comment ships to every consumer and shows up on editor hover.
 *   `CLAUDE.md` makes the exported types the canonical public contract; a
 *   contract nobody outside this repo can read is not a contract.
 * - A Portuguese identifier in the public surface is worse still — one shipped
 *   in `@theokit/sdk/compaction` for several releases before this gate existed,
 *   and renaming it was a breaking change. The cost compounds with every
 *   release that carries it.
 * - Test names are executable documentation (`.claude/rules/testing.md` § 3).
 *
 * Detection is two-tier so precision is auditable:
 *
 * - Tier 1 (near-deterministic): Latin letters carrying diacritics that
 *   Portuguese uses and English does not. Loanwords English genuinely borrows
 *   are in `WORD_ALLOWLIST`.
 * - Tier 2 (lexical): unaccented Portuguese words with no English homograph.
 *   Deliberately conservative — short words and cross-language homographs
 *   (`com`, `para`, `mais`, `de`, `os`, `em`, `no`) are NOT listed, because a
 *   false BLOCK on a lint gate is worse than a miss. A Portuguese comment
 *   written entirely without accents can slip past tier 1; tier 2 narrows that
 *   gap without closing it. Stated honestly rather than claimed complete.
 *
 *   `logo` was removed from the lexicon after it flagged `logo.png`: it is a
 *   common English noun as well as Portuguese, and a lexicon entry that fires
 *   on ordinary English is a gate that teaches people to ignore it.
 *
 * @internal
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES_ROOT = join(__dirname, "..", "..", "..");

/**
 * Scanned roots, relative to `packages/`. `"."` means every workspace package.
 *
 * It scans the whole tree rather than an explicit list because the first version listed
 * `sdk/{src,tests}` and `sdk-tools/{src,tests}` — and silently missed `sdk-pty` and `sdk-budget`,
 * which carried 60 Portuguese lines nobody was watching. A gate whose coverage is a hand-kept list
 * decays the moment a package is added.
 */
const SCAN_ROOTS = ["."];

/**
 * Loanwords English legitimately borrows with their diacritics. `façade` is a
 * locked term in `CLAUDE.md` ("Agent façade"), so it is not a violation.
 */
const WORD_ALLOWLIST = new Set(["façade", "façades", "naïve", "café", "résumé"]);

/** Files exempt from the scan, relative to `packages/`. */
const FILE_ALLOWLIST = new Set<string>([
  // This file names Portuguese words in order to ban them.
  "sdk/tests/lint/no-ptbr.test.ts",
]);

/**
 * Portuguese words with no English homograph. Every entry earns its place by
 * being unambiguous — see the honesty note in the file header for what is
 * deliberately excluded.
 */
const PT_LEXICON = new Set([
  "nao",
  "sao",
  "estao",
  "entao",
  "tambem",
  "porque",
  "porem",
  "apenas",
  "somente",
  "sempre",
  "agora",
  "aqui",
  "ainda",
  "quando",
  "onde",
  "quem",
  "isso",
  "isto",
  "esse",
  "essa",
  "aquele",
  "aquilo",
  "muito",
  "deve",
  "pode",
  "fazer",
  "usar",
  "precisa",
  "garante",
  "devolve",
  "retorna",
  "chama",
  "cria",
  "criar",
  "grava",
  "gravar",
  "escreve",
  "arquivo",
  "arquivos",
  "erro",
  "erros",
  "falha",
  "falhas",
  "dono",
  "chave",
  "caminho",
  "linha",
  "mesmo",
  "outro",
  "depois",
  "antes",
  "sobre",
  "durante",
  "atraves",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "nesse",
  "neste",
  "nessa",
  "desta",
  "deste",
  "disso",
  "seu",
  "sua",
  "seus",
  "suas",
  "nosso",
  "nossa",
  "voce",
  "eles",
  "elas",
  "cada",
  "usuario",
  "funcao",
  "nivel",
  "versao",
  "razao",
  "opcao",
  "acao",
  "persistencia",
  "obsolescencia",
  "robustez",
  "correcao",
  "correcoes",
  "possivel",
  "adquirir",
  "soltar",
  "propria",
  "proprio",
  "apos",
  "conteudo",
  "leitura",
  "escrita",
  "sessao",
  "sessoes",
  "janela",
  "motivo",
  "reclamavel",
  "tentativa",
  "teto",
  "montar",
  "parsear",
  "descartar",
  "compartilhado",
  "declarada",
  "efetiva",
  "quebra",
  "pendente",
  "pendencia",
  "resposta",
  "pergunta",
  "saida",
  "entrada",
  "tamanho",
  "vazio",
  "aviso",
  "checar",
  "validar",
  "limpar",
  "buscar",
  "juntar",
  "separar",
  "calcular",
  "aplicar",
  "anterior",
  "proximo",
  "primeiro",
  "ultimo",
  "senao",
  "assim",
  "ambos",
  "ambas",
  "ainda",
  "pois",
]);

/**
 * Latin letters carrying diacritics that Portuguese uses. Excludes the
 * mathematical `×` (U+00D7) and `÷` (U+00F7), which fall inside the naive
 * Latin-1 range and would otherwise produce false positives.
 */
const DIACRITIC = /[À-ÖØ-öø-ÿ]/;

const WORD = /[A-Za-zÀ-ÿ]+/g;

/**
 * Identifiers that are not prose and must not be tokenized as words.
 *
 * IANA timezone ids are the live case: `America/Sao_Paulo` is a standardized key, and splitting it
 * yields `Sao`, which the lexicon reads as an unaccented `são`. Mutilating the lexicon to hide that
 * would blind the gate to the real word, so the noise is removed from the line instead.
 */
const NOT_PROSE =
  /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+/g;

interface Offender {
  file: string;
  line: number;
  tier: "diacritic" | "lexicon";
  words: string[];
  text: string;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // A scan root that does not exist is not a violation — packages come and go.
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name === "coverage") continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Split an identifier into its camelCase / PascalCase / snake_case parts. */
function identifierParts(word: string): string[] {
  return word.split(/[_$]/).flatMap((p) => p.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? []);
}

function stripDiacritics(word: string): string {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Every word-part of a line, with allowlisted loanwords already dropped. */
function candidateParts(line: string): string[] {
  return (line.replace(NOT_PROSE, " ").match(WORD) ?? [])
    .filter((token) => !WORD_ALLOWLIST.has(token.toLowerCase()))
    .flatMap(identifierParts)
    .filter((part) => !WORD_ALLOWLIST.has(part.toLowerCase()));
}

/** Tier 1 wins over tier 2 so each line reports its strongest signal once. */
function classifyLine(line: string): Pick<Offender, "tier" | "words"> | undefined {
  const parts = candidateParts(line);

  const diacritic = parts.filter((p) => DIACRITIC.test(p));
  if (diacritic.length > 0) return { tier: "diacritic", words: [...new Set(diacritic)] };

  const lexical = parts.filter((p) => !DIACRITIC.test(p) && PT_LEXICON.has(stripDiacritics(p)));
  if (lexical.length > 0) return { tier: "lexicon", words: [...new Set(lexical)] };

  return undefined;
}

function scanText(rel: string, text: string): Offender[] {
  const offenders: Offender[] = [];

  text.split("\n").forEach((line, index) => {
    const hit = classifyLine(line);
    if (hit === undefined) return;
    offenders.push({ file: rel, line: index + 1, ...hit, text: line.trim().slice(0, 120) });
  });

  return offenders;
}

/** Filenames themselves must be English — a test file name is documentation. */
function scanFilename(rel: string): Offender | undefined {
  const base = rel.split(sep).pop() ?? rel;
  const hits = identifierParts(base.replace(/\.[^.]+$/, "").replace(/[.-]/g, "_")).filter(
    (p) => PT_LEXICON.has(stripDiacritics(p)) || DIACRITIC.test(p),
  );
  if (hits.length === 0) return undefined;
  return { file: rel, line: 0, tier: "lexicon", words: [...new Set(hits)], text: base };
}

async function scanFile(file: string): Promise<Offender[]> {
  const rel = relative(PACKAGES_ROOT, file).split(sep).join("/");
  if (FILE_ALLOWLIST.has(rel)) return [];

  const named = scanFilename(rel);
  const inside = scanText(rel, await readFile(file, "utf8"));
  return named === undefined ? inside : [named, ...inside];
}

async function collectOffenders(): Promise<Offender[]> {
  const offenders: Offender[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of await walk(join(PACKAGES_ROOT, root))) {
      offenders.push(...(await scanFile(file)));
    }
  }
  return offenders;
}

describe("codebase is English-only (no PT-BR)", () => {
  it("packages source and tests carry no Portuguese", async () => {
    expect(await collectOffenders()).toEqual([]);
  });
});
