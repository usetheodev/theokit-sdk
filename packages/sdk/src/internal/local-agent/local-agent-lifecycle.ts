/**
 * Lifecycle helpers for {@link import("./local-agent.js").LocalAgent} — writer-lease
 * acquisition/release, `dispose()` teardown, and `reload()` re-discovery.
 *
 * Extracted from `local-agent.ts` to keep that file under the 400-LoC guard (G8),
 * mirroring `local-agent-runtime-extensions.ts`. The grouping is by CONCEPT, not by
 * leftover: all four helpers below answer "what does this agent own outside a single
 * run, and how is it handed back?" — the store lease, the pooled MCP clients, the
 * pending disk writes, and the file-discovered submanagers.
 *
 * @internal
 */

import type { AgentDefinition, AgentOptions } from "../../types/agent.js";
import type { SessionStore } from "../../types/session-store.js";
import { diag } from "../diagnostics.js";
import { withCwdMutex } from "../persistence/cwd-mutex.js";
import type { FileContextManager } from "../runtime/context/context-manager.js";
import type { PluginsManager } from "../runtime/plugins/plugins-manager.js";
import { flushRegistrySaves } from "../runtime/registry/agent-registry.js";
import { liveAgentRegistry } from "../runtime/registry/live-agent-registry.js";
import type { SkillsManager } from "../runtime/skills/skills-manager.js";
import { loadSubagents } from "../runtime/skills/subagents-loader.js";
import { descartarSessao } from "../session/agent-session.js";
import { flushSessionWrites } from "../session/index.js";
import { disposeSessionMcpClients } from "./real-local-run.js";

/**
 * Toma o lease de escritor quando o store souber tomá-lo.
 *
 * Testar a capacidade em vez de exigi-la na interface mantém a porta de dois métodos que
 * `types/session-store.ts` declara — um store externo (Postgres, S3) não tem lease de arquivo e não
 * deve ser obrigado a fingir que tem (ISP).
 *
 * @internal
 */
export async function adquirirLeaseSePossivel(store: unknown, agentId: string): Promise<void> {
  const a = (store as { acquire?: (id: string) => Promise<void> }).acquire;
  if (typeof a !== "function") return;
  try {
    await a.call(store, agentId);
  } catch (err) {
    // `SessionBusyError` PROPAGA — é o ponto inteiro: outro processo detém a sessão, e quem
    // chamou precisa decidir (o `exec` forka para um id novo).
    if (err instanceof Error && err.name === "SessionBusyError") throw err;
    // Qualquer outra falha de I/O (EACCES num diretório read-only, ENOSPC) **não** é disputa: não
    // há segundo escritor, há um lugar onde nada se escreve. Derrubar o init nesse caso trocaria
    // "sem proteção contra concorrência" por "agente não sobe" — e a gravação em si já é
    // best-effort por contrato, então o turno seguiria igual sem o lease.
    //
    // Medido: nove testes de personality usam um `baseDir` sob `/var/empty`, onde o `mkdir` do
    // lease falha. Eles nunca escrevem transcript; exigir o lease ali seria exigir permissão para
    // proteger um arquivo que não existe.
    diag(
      `[theokit-sdk] writer lease unavailable for ${agentId} (${
        err instanceof Error ? err.message : String(err)
      }) — proceeding without single-writer protection\n`,
    );
  }
}

/**
 * Solta o lease de um agente, quando o store souber soltá-lo por id.
 *
 * `SessionStore` é uma porta de **dois métodos** por contrato (`types/session-store.ts`), e um store
 * injetado pelo consumidor não é obrigado a ter ciclo de vida. Testar a capacidade em vez de
 * exigi-la na interface mantém a porta pequena — alargá-la obrigaria todo store externo a
 * implementar um método que a maioria não precisa (ISP).
 *
 * @internal
 */
export async function soltarLeaseSePossivel(store: unknown, agentId: string): Promise<void> {
  const r = (store as { release?: (id: string) => Promise<void> }).release;
  if (typeof r === "function") await r.call(store, agentId);
}

async function disposeSessionStore(store: unknown): Promise<void> {
  const d = (store as { dispose?: () => Promise<void> }).dispose;
  if (typeof d === "function") await d.call(store);
}

/**
 * What {@link disposeLocalAgentSession} needs off the agent. Structural (not the class) so the
 * teardown order stays testable without constructing a whole `LocalAgent`.
 *
 * @internal
 */
export interface LocalAgentDisposeTarget {
  readonly agentId: string;
  readonly workspaceCwd: string;
  readonly lifecycleAbortController: AbortController;
  readonly sessionStore: SessionStore;
}

/**
 * Tear down everything the agent holds beyond a single run. The CALLER owns the
 * `disposed` flag (idempotence guard) — this function assumes it was already flipped.
 *
 * Order is load-bearing and is the reason this is one function rather than inline steps:
 * flush disk writes BEFORE releasing the store, or the lease is handed back with a write
 * still pending.
 *
 * @internal
 */
export async function disposeLocalAgentSession(agent: LocalAgentDisposeTarget): Promise<void> {
  // Evict from live cache so the next Agent.getOrCreate(id) builds fresh.
  liveAgentRegistry.forget(agent.agentId);
  // D319: fire the lifecycle abort so any in-flight LLM `fetch()` cancels.
  // `abort()` is idempotent — safe to call even when already aborted.
  agent.lifecycleAbortController.abort();
  // Wait for any in-flight send + post-run lifecycle to release the per-agent send mutex.
  // Without this, `dispose()` could return before `writeSessionSummary` finishes, leaving the
  // caller to read a partially-written `.theokit/memory/sessions/<runId>.md` file.
  await withCwdMutex(`agent-send:${agent.agentId}`, () => Promise.resolve());
  // M77 — release this session's pooled MCP clients (`mcpLifecycle: 'session'`). A pooled client
  // outlives the run by design; without this it would outlive the AGENT too, leaving an orphan
  // child process per server for the life of the host. No-op for the default `'run'` lifecycle,
  // which never puts anything in the pool.
  disposeSessionMcpClients(agent.agentId);
  // Now flush any remaining disk writes so the on-disk state matches the in-memory state
  // before the caller proceeds (ADR D17 + D18).
  await flushSessionWrites();
  await flushRegistrySaves(agent.workspaceCwd);
  // M95 — solta o lease de escritor e apaga as QUATRO caches de módulo deste agente.
  //
  // A ordem importa: depois do `flushSessionWrites`, senão soltaríamos o lease com escrita
  // pendente. `invalidateSessionCache` limpava dois dos quatro mapas; `pendingWrites` e
  // `recordCounts` nunca eram apagados por id e cresciam pela vida do processo.
  await disposeSessionStore(agent.sessionStore);
  descartarSessao(agent.workspaceCwd, agent.agentId);
}

/**
 * What {@link reloadLocalAgent} needs off the agent.
 *
 * @internal
 */
export interface LocalAgentReloadTarget {
  readonly workspaceCwd: string;
  readonly settingSourcesIncludeProject: boolean;
  readonly options: AgentOptions;
  readonly context?: FileContextManager;
  readonly skillsManager: SkillsManager | undefined;
  readonly pluginsManager: PluginsManager | undefined;
}

/**
 * Re-read every file-discovered source and return the freshly resolved subagents (the one
 * piece of reload state that lives on the agent, so the caller assigns it).
 *
 * @internal
 */
export async function reloadLocalAgent(
  agent: LocalAgentReloadTarget,
): Promise<Record<string, AgentDefinition>> {
  if (agent.context !== undefined) await agent.context.refresh();
  if (agent.skillsManager !== undefined) await agent.skillsManager.refresh();
  if (agent.pluginsManager !== undefined) await agent.pluginsManager.refresh();
  return await loadSubagents(
    agent.workspaceCwd,
    agent.settingSourcesIncludeProject,
    agent.options.agents,
  );
}
