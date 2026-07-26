/**
 * Shared `safePathJoin + assertNoSymlinkEscape` helper for built-in coding
 * tools (git-diff, run-vitest, list-dir, read-file, search-text). Returns a
 * pre-formatted `path_traversal` JSON string on failure or `null` on pass.
 *
 * @internal
 */

import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

export function checkPathScope(path: string | undefined, projectRoot: string): string | null {
  if (path === undefined || path === "") return null;
  try {
    const abs = safePathJoin(projectRoot, path);
    assertNoSymlinkEscape(abs, projectRoot);
    return null;
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path });
    }
    throw err;
  }
}

/**
 * Segmentos que nunca podem aparecer num caminho honrado por `allowAbsolute`.
 *
 * M76 — promovido de `read-file.ts`, onde era privado. Duplicá-lo em `list-dir` seria duplicação de
 * CONHECIMENTO de segurança: as cópias teriam de concordar sobre o que é segredo, e uma corrigida
 * sem a outra reabre o buraco na tool esquecida.
 */
const SEGMENTOS_SENSIVEIS = new Set([".env", ".git", "node_modules", ".theo"]);

/**
 * Guard de segredo por QUALQUER segmento — a metade de `allowAbsolute` que não pode ser separada.
 *
 * `isForbiddenPath` só bloqueia o item sensível quando ele é o PRIMEIRO segmento (relativo ao
 * projeto). Um caminho absoluto (`/home/u/proj/.env/sub`) o põe mais fundo, e passaria. Este checa
 * todos os segmentos, fechando a exfiltração "reads-anywhere".
 */
export function ehProibidoEmQualquerProfundidade(path: string): boolean {
  const segs = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segs.some((s) => {
    if (s === ".env.example") return false; // template — seguro
    return SEGMENTOS_SENSIVEIS.has(s) || /^\.env\./.test(s);
  });
}
