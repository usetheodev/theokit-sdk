/**
 * Memory path selector (SDK 2.0 Phase 1 physical Stage 2b — iter 22).
 *
 * Pure helpers the future kernel flip will use to choose between
 * legacy direct-call path and new MemoryProvider port path. Shipped
 * in isolation so the helpers are tested + frozen BEFORE the actual
 * `LocalAgent.send()` refactor wires them.
 *
 * Gate semantics (option A from the progress doc):
 *   - Default: legacy path (zero behavior change).
 *   - `THEOKIT_PORT_MEMORY_PATH=1` (env var): port path active.
 *
 * Why env var (vs option flag):
 *   - Easy to flip on/off at runtime without rebuild.
 *   - No public API surface added (the env var is internal-only;
 *     consumers don't see it in their TypeScript types).
 *   - Future iter can remove the env var once port path is the
 *     unconditional default — no deprecation cycle on the public API.
 *
 * @internal
 */

import type { CustomTool } from "../../../types/agent.js";
import type { MemoryToolSpec } from "../../agent-loop/types.js";
import type { MemoryProvider } from "./memory-provider.js";

/** Env var name — internal, not in public docs yet. */
export const PORT_MEMORY_PATH_ENV_VAR = "THEOKIT_PORT_MEMORY_PATH";

/**
 * Returns true when the port-memory-path should be active for this send.
 *
 * Checks both `process.env` (Node) and `globalThis.process?.env`
 * (defensive — some test environments stub process differently).
 */
export function shouldUsePortMemoryPath(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (env === undefined) return false;
  const val = env[PORT_MEMORY_PATH_ENV_VAR];
  return val === "1" || val === "true";
}

/**
 * Pick which `MemoryProvider` (if any) gets passed to the agent loop.
 *
 * Semantics:
 *   - When consumer-supplied `options.memoryProvider` is set: ALWAYS
 *     honor it (regardless of env flag). The flag only affects the
 *     fall-back default.
 *   - When consumer didn't supply AND port path enabled: return the
 *     auto-installed `defaultMemoryProviderForLoop` (the adapter).
 *   - When consumer didn't supply AND port path disabled: return
 *     `undefined` (legacy path; agent-loop sees no provider).
 */
export function resolveMemoryProviderForLoop(
  consumerSupplied: MemoryProvider | undefined,
  defaultAdapter: MemoryProvider,
  portPathEnabled: boolean,
): MemoryProvider | undefined {
  if (consumerSupplied !== undefined) return consumerSupplied;
  if (portPathEnabled) return defaultAdapter;
  return undefined;
}

/**
 * Pick which `memoryTools` (if any) get passed to the agent loop's
 * `inputs.memoryTools` field.
 *
 * Semantics:
 *   - When port path active: return `undefined` (tools surface via
 *     `provider.buildTools()` inside agent-loop instead — iter 18 T1.5.2).
 *   - When port path inactive: return the legacy tools (from
 *     `memoryGlue.ensureTools()`).
 */
export function resolveMemoryToolsForLoop(
  legacyTools: ReadonlyArray<MemoryToolSpec> | undefined,
  portPathEnabled: boolean,
): ReadonlyArray<MemoryToolSpec> | undefined {
  if (portPathEnabled) return undefined;
  return legacyTools;
}

/**
 * Pick the `activeMemorySummary` value to fold into the system-prompt
 * assembly.
 *
 * Semantics:
 *   - When port path active: return `undefined` (additions surface via
 *     `provider.runActivePass()` inside agent-loop instead — iter 18 T1.5.3).
 *   - When port path inactive: return the legacy summary (from
 *     `memoryGlue.runActiveMemoryIfEnabled(...)`).
 */
export function resolveActiveMemorySummaryForSend(
  legacySummary: string | undefined,
  portPathEnabled: boolean,
): string | undefined {
  if (portPathEnabled) return undefined;
  return legacySummary;
}

/**
 * Type-only re-export for downstream consumers of the helpers.
 * `CustomTool` is the port's tool shape; future iter may need it
 * when assembling memoryTools via the port path.
 */
export type { CustomTool };
