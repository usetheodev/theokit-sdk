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
export interface TelemetryAdapter {
  moduleName: string;
  displayName: string;
  detect: () => boolean;
  register: () => void;
}
