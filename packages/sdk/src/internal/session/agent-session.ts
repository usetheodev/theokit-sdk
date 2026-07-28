import type { SessionStore } from "../../types/session-store.js";
import {
  type PersistTurnInput,
  persistTurn,
  readSessionMessages,
  type TranscriptLocation,
} from "./agent-session-store.js";

/**
 * Per-agent conversation history kept across runs (and across `Agent.resume()`
 * within the same process). Lets the fixture responder recall prior facts when
 * the user asks a follow-up question.
 *
 * SE40 — disk persistence IS the native Claude-shaped `.jsonl` transcript. The
 * in-memory cache holds the narrowed `SessionMessage[]` (user/assistant text) so
 * a send can read `priorMessages` synchronously; the whole rich turn (user +
 * assistant + tool blocks) lands on disk once per send via {@link persistTurnToTranscript}
 * (fed by `run.conversation()`). Hydration on resume reconstructs the session by
 * walking the transcript DAG (`readSessionMessages`).
 *
 * @internal
 */

// `SessionMessage` lives in `./session-types.ts` (leaf types file). Re-exported
// for back-compat with downstream importers that pulled it from here.
export type { SessionMessage } from "./session-types.js";

import type { SessionMessage } from "./session-types.js";

// M75 — o cache mora numa folha; ver session-cache.ts para a razao (quebra de ciclo por extracao).
export {
  hydratedKeys,
  invalidateSessionCache,
  sessions,
  transcriptKey,
} from "./session-cache.js";

import { hydratedKeys, sessions, transcriptKey } from "./session-cache.js";

const pendingWrites = new Map<string, Promise<void>>();
const recordCounts = new Map<string, number>();

/**
 * Append a session message to the in-memory cache only. Disk persistence for the
 * whole turn happens once per send via {@link persistTurnToTranscript}; the cache
 * feeds `priorMessages` / `onBeforeSend.previousMessageCount` synchronously.
 *
 * @internal
 */
export function appendSessionMessage(agentId: string, message: SessionMessage): void {
  const existing = sessions.get(agentId) ?? [];
  existing.push(message);
  // `delete` + `set` reinsere no FIM: `Map` do JS preserva ordem de inserção, então a primeira
  // chave é sempre a menos recentemente tocada. É o LRU inteiro, sem estrutura nova (rung 2/5 da
  // parcimônia — a ordenação que precisamos já é garantia da linguagem).
  sessions.delete(agentId);
  sessions.set(agentId, existing);
  aplicarTeto();
}

/**
 * Teto de sessões mantidas em memória.
 *
 * O runtime só lê a sessão **ativa**; o resto é cache puro, reconstruível do transcript em disco.
 * 32 é folgado de propósito — o caminho primário de remoção é o `descartarSessao()` explícito no
 * fim da vida do agente, e este teto é rede de segurança contra um processo de vida longa que roda
 * centenas de sessões (risco #2 do plano: um teto apertado poderia evictar sessão ainda referenciada
 * por um fluxo assíncrono em voo).
 */
export const TETO_DE_SESSOES_EM_CACHE = 32;

function aplicarTeto(): void {
  while (sessions.size > TETO_DE_SESSOES_EM_CACHE) {
    const maisAntiga = sessions.keys().next().value;
    if (maisAntiga === undefined) return;
    sessions.delete(maisAntiga);
    hydratedKeys.delete(maisAntiga);
    pendingWrites.delete(maisAntiga);
    recordCounts.delete(maisAntiga);
  }
}

/**
 * Apaga a escrituração de módulo do agente e devolve quantas entradas saíram.
 *
 * M95 — `invalidateSessionCache` limpava **dois** dos quatro mapas (`sessions`, `hydratedKeys`);
 * `pendingWrites` e `recordCounts` nunca eram tocados por id, então cresciam pela vida do processo.
 * Nenhum dos dois é grande por entrada — o vazamento é de contagem, não de volume — mas cache sem
 * dono da remoção é cache que só cresce.
 *
 * Devolve a contagem para que o chamador possa provar a remoção; um segundo descarte devolve 0,
 * que é o que torna o teste de idempotência possível sem expor os mapas.
 */
export function descartarSessao(cwd: string, agentId: string): number {
  const chave = transcriptKey(cwd, agentId);
  let removidas = 0;
  // `sessions` NÃO é apagado aqui — e a distinção é medida, não estética. Ele é a conversa
  // legível, e há leitor legítimo DEPOIS do dispose: o golden `two-concurrent-sends-serialize`
  // chama `getSessionMessages(agentId)` após `agent.dispose()`. Apagá-lo aqui devolvia lista vazia
  // e quebrava dois goldens. Quem o limita é o teto LRU acima; os três abaixo são escrituração
  // pura, sem leitor pós-dispose.
  if (hydratedKeys.delete(chave)) removidas++;
  if (pendingWrites.delete(agentId)) removidas++;
  if (recordCounts.delete(agentId)) removidas++;
  return removidas;
}

export function getSessionMessages(agentId: string): SessionMessage[] {
  return sessions.get(agentId) ?? [];
}

/**
 * Persist a full conversation turn (user + assistant + tool blocks) to the native
 * transcript. Chained per-(agent, transcript) so on-disk order matches send order,
 * and fire-and-forget so `send()` is not blocked by disk I/O. Every
 * M50 — when the caller supplies `turn.autoCompact`, size-driven auto-compaction (usage real vs
 * the model's context window) runs in this same chain, surfaced via the optional `onCompact` observer.
 *
 * @internal
 */
export function persistTurnToTranscript(
  store: SessionStore,
  loc: TranscriptLocation,
  sessionId: string,
  turn: PersistTurnInput,
  onCompact?: () => void,
): void {
  const key = transcriptKey(loc.cwd, loc.agentId);
  // Divida PRE-EXISTENTE, exposta quando o M75 consertou a config Biome que abortava antes
  // de varrer estes arquivos (raiz aninhada em refactor/). Nao e codigo novo e nao foi tocado
  // pelo M75; refatorar internals do SDK sem revisao trocaria um problema visivel por um diff
  // arriscado. Rastreado em usetheodev/theokit-sdk#151.
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ver a razao logo acima
  const chained = (pendingWrites.get(key) ?? Promise.resolve()).then(async () => {
    try {
      await persistTurn(store, loc, sessionId, turn);
      const count = (recordCounts.get(key) ?? 0) + 1;
      recordCounts.set(key, count);
      // M50 — the 50-turn no-summary boundary stub is GONE (it silently amnesia'd the session).
      // Auto-compaction is now size-driven with a real summary: see `maybeAutoCompact` below,
      // invoked in this same write chain by the post-run lifecycle when usage is known.
      if (turn.autoCompact !== undefined) {
        const { autoCompactIfNeeded } = await import("./compact-session.js");
        const fired = await autoCompactIfNeeded({
          store,
          loc,
          sessionId,
          usageTotal: turn.autoCompact.usageTotal,
          contextWindow: turn.autoCompact.contextWindow,
          turnCount: count,
          summarize: turn.autoCompact.summarize,
        });
        if (fired) onCompact?.();
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(
        `[theokit-sdk] session transcript write failed (${loc.agentId}): ${msg}\n`,
      );
    }
  });
  pendingWrites.set(
    key,
    chained.then(
      () => undefined,
      () => undefined,
    ),
  );
}

/**
 * Load the persisted transcript into the in-memory cache. Idempotent per
 * (baseDir, cwd, agentId). Call once per agent lifecycle before the first read.
 *
 * @internal
 */
export async function hydrateSession(
  agentId: string,
  loc: { store: SessionStore; cwd: string },
): Promise<void> {
  const key = transcriptKey(loc.cwd, agentId);
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);

  const persisted = await readSessionMessages(loc.store, agentId);
  if (persisted.length === 0) return;
  // M51 review F4 — the DISK is the source of truth at hydration time: after an invalidation
  // (compact/inject), an in-flight turn may have repopulated the cache with a SINGLE message before
  // this hydrate ran; the old "skip when non-empty" guard then pinned the parent to a 1-message
  // context (history + injected pair lost until restart). The persist chain serializes writes, so
  // the disk already contains that in-flight turn — replacing is always correct.
  sessions.set(agentId, persisted);
}

/**
 * Wait for all pending transcript writes to settle. Used by tests and by the
 * agent dispose path so on-disk state matches in-memory before the caller proceeds.
 *
 * @internal
 */
export async function flushSessionWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    const all = Array.from(pendingWrites.values());
    pendingWrites.clear();
    await Promise.all(all);
  }
}

export function clearSession(agentId: string): void {
  sessions.delete(agentId);
}

/**
 * M50 review F1 — drop BOTH the message cache and the hydration marker so the NEXT send re-hydrates
 * from disk. Without this, a compaction only helps after a process restart: the live process keeps
 * sending the full pre-compact history (the cache is read synchronously by every send).
 */
/**
 * M50 review F5 — run `fn` serialized on the SAME per-(cwd,agentId) write chain the per-turn
 * persistence uses, so a manual `Agent.compact` can never interleave with an in-flight turn's
 * writes (boundary landing mid-turn would orphan the turn from the replay).
 */
export function enqueueSessionWrite<T>(
  cwd: string,
  agentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = transcriptKey(cwd, agentId);
  const prior = pendingWrites.get(key) ?? Promise.resolve();
  const result = prior.then(fn);
  pendingWrites.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** Test-only: drop every cached session and hydration marker. @internal */
export function clearAllSessions(): void {
  sessions.clear();
  hydratedKeys.clear();
  recordCounts.clear();
  // M50 review F11 — the auto-compact attempt marks live on globalThis; tests reset them here.
  const g = globalThis as unknown as Record<symbol, Map<string, number>>;
  const sym = Symbol.for("theokit-sdk.session.auto-compact-attempts");
  g[sym]?.clear();
}
