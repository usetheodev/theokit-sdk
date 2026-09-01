/**
 * Types for the ADR-index generator, which is authored as `.mjs` so it runs with plain `node` and no
 * build step — the same shape as the other scripts in this directory.
 *
 * Declared here rather than converting the script to TypeScript: a generator invoked by hand and by
 * one test does not need a compile step, and `tests/lint/adr-index-covers-citations.test.ts` needs the
 * exported collector to be typed.
 */

/** One place a D-number is cited, from a comment line in `src/`. */
export interface AdrCitation {
  /** Package-relative path, POSIX separators. */
  file: string;
  /** 1-indexed. */
  line: number;
  /** The citing comment line, comment markers stripped. */
  text: string;
}

/**
 * Scans comment lines under `root` and groups D-number citations by number.
 *
 * Comment lines only: a `D` followed by digits inside code is an identifier, not a citation.
 */
export declare function collectCitations(root?: string): Map<string, AdrCitation[]>;
