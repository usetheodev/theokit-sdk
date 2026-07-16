import { mkdir, readFile } from "node:fs/promises";

import { ConfigurationError } from "@theokit/sdk/errors";
import { safePathJoin, sanitizeIdentifier } from "@theokit/sdk/path-safety";
import { replaceFileAtomic, withCwdMutex } from "@theokit/sdk/persistence";

import { type MemoryFact, redactSecrets } from "./memory-types.js";

/**
 * A fact stored under a typed category. Unlike the flat {@link MemoryFact}, the
 * `category` is always present in the categorized store's read shape.
 *
 * @public
 */
export interface CategorizedFact extends MemoryFact {
  category: string;
}

/**
 * Options for {@link createCategorizedMemory}.
 *
 * @public
 */
export interface CreateCategorizedMemoryOptions {
  /** Directory holding one markdown file per category (`<root>/<category>.md`). */
  root: string;
  /**
   * The closed category taxonomy. This list IS the schema: an `add`/`list`
   * with a category not in it is rejected. Must be non-empty, unique, each
   * sanitizable to a distinct filename.
   */
  categories: readonly string[];
}

/**
 * A typed, category-partitioned markdown memory store.
 *
 * @public
 */
export interface CategorizedMemory {
  /** The declared (frozen) category taxonomy. */
  readonly categories: readonly string[];
  /**
   * Append a fact under `category` (validated against the taxonomy). The text
   * is secret-redacted before persistence. Concurrent adds to the same category
   * are serialized (no lost update). Throws `ConfigurationError(unknown_category)`
   * for an undeclared category (before any I/O).
   */
  add(category: string, text: string): Promise<void>;
  /**
   * Read facts for one category (or every category when omitted). Never throws —
   * a missing/unreadable category file yields no facts.
   */
  list(category?: string): Promise<CategorizedFact[]>;
}

const FACTS_HEADING = "## Facts";

/**
 * Create a typed categorized memory store over the closed `categories`
 * taxonomy. Composes the shipped `safePathJoin`/`sanitizeIdentifier` path
 * guard, `redactSecrets`, and the atomic `replaceFileAtomic` + `withCwdMutex`
 * persistence primitives — zero new dependencies.
 *
 * @public
 */
export function createCategorizedMemory(
  options: CreateCategorizedMemoryOptions,
): CategorizedMemory {
  const { root, categories } = options;
  validateCategories(categories);
  const allowed = new Set(categories);

  function assertKnown(category: string): void {
    if (!allowed.has(category)) {
      throw new ConfigurationError(
        `createCategorizedMemory: unknown category ${JSON.stringify(category)} (declared: ${categories.join(", ")})`,
        { code: "unknown_category" },
      );
    }
  }

  function categoryPath(category: string): string {
    return safePathJoin(root, `${sanitizeIdentifier(category)}.md`);
  }

  async function add(category: string, text: string): Promise<void> {
    assertKnown(category);
    // Redact secrets, THEN encode newlines/backslashes so a multiline fact (or
    // one containing a `- ` / `## ` line) stays a single bullet and round-trips
    // faithfully — `list` decodes it back. Without this, the `## Facts` bullet
    // parse would split or truncate the fact (silent data loss).
    const encoded = encodeFact(redactSecrets(text));
    const sane = sanitizeIdentifier(category);
    await withCwdMutex(`catmem:${root}:${sane}`, async () => {
      const path = safePathJoin(root, `${sane}.md`);
      const raw = (await readFileOrEmpty(path)) || header(category);
      await mkdir(root, { recursive: true });
      await replaceFileAtomic(path, appendBullet(raw, encoded));
    });
  }

  async function list(category?: string): Promise<CategorizedFact[]> {
    if (category !== undefined) {
      assertKnown(category);
      return readCategory(categoryPath(category), category);
    }
    const out: CategorizedFact[] = [];
    for (const c of categories) {
      out.push(...(await readCategory(categoryPath(c), c)));
    }
    return out;
  }

  return { categories: [...categories], add, list };
}

function validateCategories(categories: readonly string[]): void {
  if (categories.length === 0) {
    throw new ConfigurationError("createCategorizedMemory: categories must be non-empty", {
      code: "invalid_categories",
    });
  }
  if (new Set(categories).size !== categories.length) {
    throw new ConfigurationError("createCategorizedMemory: categories must be unique", {
      code: "invalid_categories",
    });
  }
  const sanitized = categories.map((c) => trySanitize(c));
  if (new Set(sanitized).size !== categories.length) {
    throw new ConfigurationError(
      "createCategorizedMemory: categories must map to distinct filenames after sanitization",
      { code: "invalid_categories" },
    );
  }
}

function trySanitize(category: string): string {
  try {
    return sanitizeIdentifier(category);
  } catch (cause) {
    throw new ConfigurationError(
      `createCategorizedMemory: category ${JSON.stringify(category)} is not a valid identifier`,
      { code: "invalid_categories", cause },
    );
  }
}

function header(category: string): string {
  return `---\ncategory: ${category}\n---\n\n${FACTS_HEADING}\n`;
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readCategory(path: string, category: string): Promise<CategorizedFact[]> {
  const raw = await readFileOrEmpty(path);
  return parseFactBullets(raw).map((text) => ({ text: decodeFact(text), category }));
}

/**
 * Encode a fact for single-bullet storage: escape `\` first, then `\r`/`\n`, so
 * the text occupies exactly one `- ` line (no split, no `## ` heading injection).
 * Pure + reversible by {@link decodeFact}.
 */
function encodeFact(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/**
 * Reverse {@link encodeFact}. A single left-to-right pass over each `\<char>`
 * escape: `\n`→newline, `\r`→CR, and any other escaped char (notably `\\`)→the
 * literal char. Non-overlapping matching makes this exact for encoded input.
 */
function decodeFact(text: string): string {
  return text.replace(/\\(.)/g, (_match, char: string) =>
    char === "n" ? "\n" : char === "r" ? "\r" : char,
  );
}

/** Parse `- text` bullets under the `## Facts` heading. Pure. */
function parseFactBullets(raw: string): string[] {
  const idx = raw.indexOf(FACTS_HEADING);
  if (idx === -1) return [];
  const tail = raw.slice(idx + FACTS_HEADING.length);
  const nextHeading = tail.search(/\n#{1,2}\s/);
  const block = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

/** Append a `- text` bullet under the `## Facts` heading. Pure. */
function appendBullet(raw: string, text: string): string {
  const bullet = `- ${text}`;
  const idx = raw.indexOf(FACTS_HEADING);
  if (idx === -1) {
    const sep = raw.endsWith("\n") ? "" : "\n";
    return `${raw}${sep}${FACTS_HEADING}\n\n${bullet}\n`;
  }
  const after = idx + FACTS_HEADING.length;
  const nextHeading = raw.slice(after).search(/\n#{1,2}\s/);
  if (nextHeading === -1) {
    const trailing = raw.endsWith("\n") ? "" : "\n";
    return `${raw}${trailing}${bullet}\n`;
  }
  const insertAt = after + nextHeading;
  return `${raw.slice(0, insertAt)}\n${bullet}${raw.slice(insertAt)}`;
}
