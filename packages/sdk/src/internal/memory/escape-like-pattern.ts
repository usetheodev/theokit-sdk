/**
 * Escapes a user query for a SQL `LIKE ... ESCAPE '\'` clause.
 *
 * The order of the three replacements is the whole correctness argument, so it is its own
 * function rather than a chain inline at the call site.
 *
 * The previous version escaped `%` and `_` but not the escape character itself, which is the
 * defect CodeQL reports as `js/incomplete-sanitization` (alerts #14, #15). Two things went wrong,
 * and the second is the one that matters:
 *
 *   "back\slash"  ->  "%back\slash%"    the `\s` is an escape of `s`, which LIKE does not define
 *   "x\%y"        ->  "%x\\%y%"         the inserted `\` is consumed escaping the user's `\`,
 *                                       leaving `%` UNESCAPED — a wildcard the caller did not
 *                                       write, matching anything between `x\` and `y`
 *
 * The second is wildcard injection: a search for a literal string silently becomes a scan. In a
 * memory index that is both a wrong answer and a way to pull back rows the query never asked for.
 *
 * Escaping the backslash FIRST is what fixes it — afterwards every `\` in the string is one this
 * function put there, so the later replacements cannot collide with a user-supplied one.
 */
export function escapeLikePattern(query: string): string {
  return `%${query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}
