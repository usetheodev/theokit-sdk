/**
 * Task-id grammar (D368) — runtime, deliberately NOT in `types/`.
 *
 * It lived in `types/task.ts`, which `types/index.ts` re-exports with `export type *`. That star
 * cannot carry a value, so the only reason `isValidTaskId` ever reached a consumer is that the DTS
 * rollup hoists the declaration while the runtime bundle emits nothing — exactly the shape of #279,
 * where the import typechecked and was `undefined` at the call site. `src/index.ts` re-exports both
 * names from here, so the public API is unchanged.
 *
 * @internal
 */

/**
 * Grammar for user-supplied task IDs (D368).
 * `crypto.randomUUID()` outputs do NOT match this (UUIDs have dashes
 * AND uppercase letters in their canonical form on some Node versions),
 * but the registry normalizes auto-generated IDs to lowercase before
 * insertion, so they pass the same regex.
 */
const TASK_ID_GRAMMAR = /^[a-z0-9][a-z0-9_-]*$/;

/** Reserved prefixes for adapter-generated IDs (D368, EC-5). */
const RESERVED_PREFIXES = ["wf-", "b-", "cron-"] as const;

/**
 * Validates a task ID against the public grammar + reserved prefixes.
 * Throws `InvalidTaskIdError` from `../errors.js` on rejection.
 *
 * Adapter callers (workflow/batch/cron) MUST set `allowReserved: true`
 * to register their own IDs; user-facing surfaces (`Task.submit`,
 * `agent.send({ task: { id } })`) leave it false.
 */
export function isValidTaskId(id: string, allowReserved: boolean): boolean {
  if (!TASK_ID_GRAMMAR.test(id)) return false;
  if (allowReserved) return true;
  for (const prefix of RESERVED_PREFIXES) {
    if (id.startsWith(prefix)) return false;
  }
  return true;
}

/** Re-exported for adapter implementations + tests. */
export const TASK_RESERVED_PREFIXES: readonly string[] = RESERVED_PREFIXES;
