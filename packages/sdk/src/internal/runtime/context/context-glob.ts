/**
 * Shared glob → RegExp compiler for context discovery (extracted from the
 * MDC parser so the `.cursor/rules/*.mdc` and `.theokit/rules/*.md` parsers
 * share ONE implementation — DRY, no new dependency).
 *
 * Supports `**` (any depth), `*` (single path segment, no `/`), `?` (single
 * non-separator char). Sufficient for the patterns Cursor and Claude Code
 * themselves recommend.
 *
 * @internal
 */
export function globToRegex(glob: string): RegExp {
  // Support **/ (zero-or-more path segments), ** (any depth), * (single
  // segment), ? (single non-separator char). `**/` collapses so `src/**/*.ts`
  // matches `src/foo.ts` AND `src/a/b/foo.ts` — the semantics Cursor and Claude
  // Code document ("src/**/* → all files under src/"). `*` and `?` never cross a
  // `/` (strict glob segment semantics). Escape other regex metas.
  const compiled = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "::GLOBSTAR_SLASH::")
    .replace(/\*\*/g, "::GLOBSTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/::GLOBSTAR_SLASH::/g, "(?:.*/)?")
    .replace(/::GLOBSTAR::/g, ".*");
  return new RegExp(`^${compiled}$`);
}

/**
 * True when any of `patterns` glob-matches any of `paths`. Central helper so
 * both rule parsers agree on activation semantics.
 *
 * @internal
 */
export function anyGlobMatches(
  patterns: ReadonlyArray<string>,
  paths: ReadonlyArray<string>,
): boolean {
  if (patterns.length === 0 || paths.length === 0) return false;
  const res = patterns.map(globToRegex);
  return paths.some((p) => res.some((re) => re.test(p)));
}
