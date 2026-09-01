import type { TelemetrySettings } from "../../types/agent.js";
import { diag } from "../diagnostics.js";
import { arizeAdapter } from "./adapters/arize.js";
import { braintrustAdapter } from "./adapters/braintrust.js";
import { datadogAdapter } from "./adapters/datadog.js";
import { langfuseAdapter } from "./adapters/langfuse.js";
import { langsmithAdapter } from "./adapters/langsmith.js";
import { posthogAdapter } from "./adapters/posthog.js";
import { sentryAdapter } from "./adapters/sentry.js";
import type { TelemetryAdapter, TelemetryWiring } from "./safe-require.js";

// Re-export the shared adapter contract for callers that consume registry
// types directly. Implementation lives in `safe-require.ts` to keep the
// adapter modules acyclic (depcruise enforces no-circular).
export type { TelemetryAdapter, TelemetryWiring };

/**
 * Auto-instrumentation adapter registry (ADR D42).
 *
 * Each adapter feature-detects a vendor lib (`@langfuse/node`, `@sentry/node`,
 * `posthog-node`) via `createRequire` and wires it into the active OTel
 * tracer provider. Errors in any adapter are caught — they never propagate
 * to `agent.send`.
 *
 * @internal
 */

/**
 * The diagnostic sentence per outcome. Braintrust and LangSmith used to print
 * "auto-instrumented" while having installed nothing at all — the log claimed a
 * wired pipeline where there was a loaded module.
 */
const WIRING_PROSE: Record<TelemetryWiring, string> = {
  instrumented: "auto-instrumented",
  "vendor-auto-instruments": "loaded; the vendor instruments itself from its env var",
  "not-wired": "detected but nothing was wired",
};

const ALL_ADAPTERS: TelemetryAdapter[] = [
  langfuseAdapter,
  sentryAdapter,
  posthogAdapter,
  datadogAdapter,
  langsmithAdapter,
  arizeAdapter,
  braintrustAdapter,
];

/**
 * moduleName -> what its `register()` actually wired. A Map rather than the
 * former Set because membership answered only "did we call it", and the two
 * env-var adapters made that the wrong question: they are in the set having
 * installed nothing.
 */
const registered = new Map<string, TelemetryWiring>();

/**
 * Try to register every detected adapter. Idempotent: subsequent calls
 * skip already-registered adapters.
 *
 * @internal
 */
export function tryAutoRegisterAdapters(settings: TelemetrySettings | undefined): void {
  if (settings?.enabled !== true) return;
  if (settings.autoDetect === false) return;
  const disabled = new Set(settings.disable ?? []);
  for (const adapter of ALL_ADAPTERS) {
    if (registered.has(adapter.moduleName)) continue;
    if (disabled.has(adapter.displayName.toLowerCase())) continue;
    if (!adapter.detect()) continue;
    registerOne(adapter);
  }
}

/**
 * Run ONE detected adapter and record what it wired. Extracted from the loop
 * above so a test can exercise the record-and-narrate step against a fixture
 * adapter without a test-only mutator on the registry — the loop iterates a
 * hard-coded list, and adding a back door to it would make the gate weaker
 * than the thing it guards.
 *
 * Errors never propagate to `agent.send`; a failing vendor is a diagnostic.
 *
 * @internal
 */
export function registerOne(adapter: TelemetryAdapter): void {
  try {
    const wiring = adapter.register();
    registered.set(adapter.moduleName, wiring);
    diag(`[theokit-sdk] telemetry: ${adapter.displayName} ${WIRING_PROSE[wiring]}.\n`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    diag(
      `[theokit-sdk] telemetry: ${adapter.displayName} detected but failed to register: ${message}\n`,
    );
  }
}

/**
 * Test helper: reset registration state.
 *
 * @internal
 */
export function _resetAdapterRegistry(): void {
  registered.clear();
}

/**
 * Test helper: check if an adapter was registered.
 *
 * @internal
 */
export function _isRegistered(moduleName: string): boolean {
  return registered.has(moduleName);
}

/**
 * Test helper: what an adapter wired, or `undefined` if it never ran.
 *
 * `_isRegistered` cannot answer this — it is true for an adapter that only
 * loaded a module, which is why the finding this closes existed.
 *
 * @internal
 */
export function _wiringOf(moduleName: string): TelemetryWiring | undefined {
  return registered.get(moduleName);
}

/**
 * Test helper: list of adapters (for inspection in tests).
 *
 * @internal
 */
export function _getAllAdapters(): readonly TelemetryAdapter[] {
  return ALL_ADAPTERS;
}
