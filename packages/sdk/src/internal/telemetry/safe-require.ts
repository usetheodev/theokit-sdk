import { createRequire } from "node:module";

/**
 * Adapter helper: safely require a module via `createRequire`, returning
 * `undefined` when not installed. Lives in its own module so adapters
 * (langfuse, sentry, posthog) can import without creating a cycle with
 * `adapter-registry.ts` (which lists them).
 *
 * @internal
 */
export function safeRequire<T = unknown>(moduleName: string): T | undefined {
  try {
    const r = createRequire(import.meta.url);
    return r(moduleName) as T;
  } catch {
    return undefined;
  }
}

/**
 * Shared adapter interface. Each adapter (langfuse, sentry, posthog) imports
 * this from `safe-require.ts` rather than `adapter-registry.ts`.
 *
 * @internal
 */
/**
 * What an adapter's `register()` actually DID — not merely that it returned.
 *
 * Five of the seven adapters install something concrete (an OTel span processor,
 * an event processor, a vendor client). Two — Braintrust and LangSmith — cannot:
 * those vendors auto-instrument from an env var, so the only honest job left is
 * to make sure the module is loaded. Both outcomes are legitimate; reporting
 * them with the same word is not, because "auto-instrumented" then stops
 * distinguishing a wired pipeline from a module that was merely imported.
 *
 * @internal
 */
export type TelemetryWiring =
  /** The adapter installed a processor, client, or hook of its own. */
  | "instrumented"
  /** The vendor instruments itself from the environment; we only loaded it. */
  | "vendor-auto-instruments"
  /** Detection passed but the module could not be loaded on the second look. */
  | "not-wired";

/**
 * Shared adapter interface. Each adapter (langfuse, sentry, posthog) imports
 * this from `safe-require.ts` rather than `adapter-registry.ts`.
 *
 * `register` returns what it wired so the registry can report it truthfully;
 * see {@link TelemetryWiring}.
 *
 * @internal
 */
export interface TelemetryAdapter {
  moduleName: string;
  displayName: string;
  detect: () => boolean;
  register: () => TelemetryWiring;
}
