import type { TelemetrySettings } from "../../types/agent.js";
import { diag } from "../diagnostics.js";
import { arizeAdapter } from "./adapters/arize.js";
import { braintrustAdapter } from "./adapters/braintrust.js";
import { datadogAdapter } from "./adapters/datadog.js";
import { langfuseAdapter } from "./adapters/langfuse.js";
import { langsmithAdapter } from "./adapters/langsmith.js";
import { posthogAdapter } from "./adapters/posthog.js";
import { sentryAdapter } from "./adapters/sentry.js";
import type { TelemetryAdapter } from "./safe-require.js";

// Re-export the shared adapter contract for callers that consume registry
// types directly. Implementation lives in `safe-require.ts` to keep the
// adapter modules acyclic (depcruise enforces no-circular).
export type { TelemetryAdapter };

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

const ALL_ADAPTERS: TelemetryAdapter[] = [
  langfuseAdapter,
  sentryAdapter,
  posthogAdapter,
  datadogAdapter,
  langsmithAdapter,
  arizeAdapter,
  braintrustAdapter,
];

const registered = new Set<string>();

/**
 * Try to register every detected adapter. Idempotent: subsequent calls
 * skip already-registered adapters.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-adapter detect/register/skip/error-handle is inherent to the registry; splitting harms the once-per-vendor narrative.
export function tryAutoRegisterAdapters(settings: TelemetrySettings | undefined): void {
  if (settings?.enabled !== true) return;
  if (settings.autoDetect === false) return;
  const disabled = new Set(settings.disable ?? []);
  for (const adapter of ALL_ADAPTERS) {
    if (registered.has(adapter.moduleName)) continue;
    if (disabled.has(adapter.displayName.toLowerCase())) continue;
    if (!adapter.detect()) continue;
    try {
      adapter.register();
      registered.add(adapter.moduleName);
      diag(`[theokit-sdk] telemetry: ${adapter.displayName} auto-instrumented.\n`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      diag(
        `[theokit-sdk] telemetry: ${adapter.displayName} detected but failed to register: ${message}\n`,
      );
    }
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
 * Test helper: list of adapters (for inspection in tests).
 *
 * @internal
 */
export function _getAllAdapters(): readonly TelemetryAdapter[] {
  return ALL_ADAPTERS;
}
