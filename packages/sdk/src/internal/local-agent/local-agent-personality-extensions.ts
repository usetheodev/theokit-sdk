/**
 * Personality-preset runtime extensions for {@link LocalAgent}.
 *
 * Extracted from `local-agent.ts` to keep that file under the 400-LoC
 * guard (G8). The functions here implement the personality-related
 * behaviour declared by ADRs D160-D168:
 *
 * - `resolveActivePersonalityPreset` — read the active preset honoring
 *   the fork ALS snapshot (D168 / EC-A).
 * - `ensurePersonalityRegistryIfNeeded` — lazy-load registry when ANY
 *   slug is active.
 * - `applyPersonalityOverlay` — overlay preset body on the base prompt.
 * - `localAgentUsePersonality` — the full `Agent.usePersonality` flow:
 *   fork-scope no-op, registry lazy-load, then delegate to
 *   `performPersonalitySwitch` under the per-agent send mutex (EC-E).
 *
 * @internal
 */

import { withCwdMutex } from "../persistence/cwd-mutex.js";
import {
  currentPersonalityContext,
  warnPersonalitySwitchInsideFork,
} from "../personality/context.js";
import { PersonalityRegistry } from "../personality/registry.js";
import type { PersonalityStore } from "../personality/store.js";
import { performPersonalitySwitch } from "../personality/switch.js";
import type { PersonalityPreset } from "../personality/types.js";
import { appendSessionMessage, clearSession } from "../runtime/session/agent-session.js";

/**
 * Read the active personality preset (if any) for this agent — pure read.
 *
 * Inside a fork (ALS scope active), reads the snapshot slug captured at
 * fork-construction time (EC-A). Outside a fork, reads the agent's own
 * `PersonalityStore`.
 *
 * @internal
 */
export function resolveActivePersonalityPreset(args: {
  agentId: string;
  personalityStore: PersonalityStore;
  personalityRegistry: PersonalityRegistry | undefined;
}): PersonalityPreset | undefined {
  const forkCtx = currentPersonalityContext();
  const slug = forkCtx !== undefined ? forkCtx.slug : args.personalityStore.active(args.agentId);
  if (slug === undefined) return undefined;
  return args.personalityRegistry?.get(slug);
}

/**
 * Lazy-load `PersonalityRegistry` when ANY personality slug is active —
 * either via the agent's own store or via fork inheritance (ALS).
 * Avoids the 10ms cold-start I/O for agents that never use personalities.
 *
 * Returns the registry (loaded or unchanged) so the caller can assign
 * it back to its private field.
 *
 * @internal
 */
export async function ensurePersonalityRegistryIfNeeded(args: {
  agentId: string;
  workspaceCwd: string;
  personalityStore: PersonalityStore;
  personalityRegistry: PersonalityRegistry | undefined;
}): Promise<PersonalityRegistry | undefined> {
  if (args.personalityRegistry !== undefined) return args.personalityRegistry;
  const forkSlug = currentPersonalityContext()?.slug;
  const ownSlug = args.personalityStore.active(args.agentId);
  if (forkSlug === undefined && ownSlug === undefined) return undefined;
  return await PersonalityRegistry.load(args.workspaceCwd);
}

/**
 * Overlay the active personality preset's `systemPrompt` body on top of
 * the resolved base prompt (ADR D160). Pure read — never mutates store.
 *
 * @internal
 */
export function applyPersonalityOverlay(
  preset: PersonalityPreset | undefined,
  base: string | undefined,
): string | undefined {
  if (preset === undefined) return base;
  if (base === undefined || base.length === 0) return preset.systemPrompt;
  return `${base}\n\n${preset.systemPrompt}`;
}

/**
 * Full `Agent.usePersonality(...)` implementation extracted from
 * `LocalAgent`. Loads the registry lazily, then delegates to
 * `performPersonalitySwitch` under the per-agent send mutex (EC-E).
 *
 * Returns the resolved preset (or null when cleared). Mutates the
 * `registryRef` callback when the registry was lazy-loaded so the agent
 * can cache it.
 *
 * @internal
 */
export async function localAgentUsePersonality(args: {
  agentId: string;
  workspaceCwd: string;
  disposed: boolean;
  personalityStore: PersonalityStore;
  personalityRegistry: PersonalityRegistry | undefined;
  invalidateCache: (reason: string) => Promise<void>;
  onRegistryLoaded: (reg: PersonalityRegistry) => void;
  name: string;
  opts?: { save?: boolean; reset?: boolean };
}): Promise<PersonalityPreset | null> {
  if (args.disposed) throw new Error("Agent has been disposed");
  // ADR D168 / EC-A — inside a fork, usePersonality is a no-op.
  if (currentPersonalityContext() !== undefined) {
    warnPersonalitySwitchInsideFork(args.agentId);
    return null;
  }
  let registry = args.personalityRegistry;
  if (registry === undefined) {
    registry = await PersonalityRegistry.load(args.workspaceCwd);
    args.onRegistryLoaded(registry);
  }
  // EC-E: serialize against in-flight `send` via the per-agent send mutex.
  return withCwdMutex(`agent-send:${args.agentId}`, () =>
    performPersonalitySwitch({
      agentId: args.agentId,
      prevSlug: args.personalityStore.active(args.agentId),
      requestedName: args.name,
      registry: registry as PersonalityRegistry,
      store: args.personalityStore,
      invalidateCache: (reason) => args.invalidateCache(reason),
      appendSessionMessage: (msg) => appendSessionMessage(args.agentId, msg),
      clearSession: () => clearSession(args.agentId),
      opts: args.opts ?? {},
    }),
  );
}
