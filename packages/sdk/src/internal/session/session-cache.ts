import type { SessionMessage } from "./session-types.js";

/**
 * O cache de sessão em memória — num módulo FOLHA, de propósito.
 *
 * O estado e o invalidador viviam em `agent-session.ts`, e `compact-session.ts` importava
 * `invalidateSessionCache` de lá — enquanto `agent-session.ts` importava `autoCompactIfNeeded` de
 * volta. O ciclo estava quebrado em runtime (a volta é `await import()` dinâmico), mas o detector
 * conta a aresta dinâmica, e contar import dinâmico como ciclo torna o gate impossível de satisfazer
 * sem abandonar a técnica canônica de quebrar ciclos.
 *
 * O dono natural deste estado nunca foi `agent-session.ts`: são dois mapas de processo que ambos os
 * módulos consultam. Extraí-los para uma folha remove o ciclo em QUALQUER detector, sem política de
 * ferramenta e sem mudar uma linha de comportamento — as mesmas instâncias de `Map`/`Set` continuam
 * sendo as únicas do processo, porque módulo ES é singleton.
 */
export const sessions = new Map<string, SessionMessage[]>();
export const hydratedKeys = new Set<string>();

/** The per-(cwd, agentId) transcript key for cache/hydration bookkeeping. */
export function transcriptKey(cwd: string, agentId: string): string {
  return `${cwd}::${agentId}`;
}

export function invalidateSessionCache(cwd: string, agentId: string): void {
  sessions.delete(agentId);
  hydratedKeys.delete(transcriptKey(cwd, agentId));
}
