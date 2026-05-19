/**
 * Result truncation cap (T2.4).
 *
 * Tools can return huge output (shell `find /`, file read). Without cap,
 * each turn inflates context. Default 100k chars covers `find / -name`
 * output in typical projects.
 *
 * @internal
 */

const DEFAULT_CAP = 100_000;

export function applyResultCap(content: string, capChars: number = DEFAULT_CAP): string {
  if (content.length <= capChars) return content;
  return `${content.slice(0, capChars)}\n\n[output truncated: ${content.length - capChars} chars omitted]`;
}
