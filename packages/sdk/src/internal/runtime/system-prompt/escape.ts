/**
 * Block-body XML escape (ADR D9 — prompt-injection defence).
 *
 * Order matters: `&` MUST be escaped first so subsequent `<`/`>` replacements
 * do not double-encode the `&` characters they introduce.
 *
 * @internal
 */
export const escapeBlockBody = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
