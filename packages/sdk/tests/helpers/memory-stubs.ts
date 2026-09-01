/**
 * The inert `MemoryAdapter` the memory-provider tests build to satisfy the port without exercising it.
 *
 * It was defined nine times — eight of them byte-identical once whitespace and the function name are
 * normalised, under two names (`makeStubAdapter`, `stubAdapter`). Every one encodes the same
 * knowledge: what the minimum `MemoryAdapter` is. Add a capability to the port, or rename a method,
 * and eight files need the same edit; miss one and it fails for a reason unrelated to what it tests.
 *
 * `tests/helpers/` already exists for this — `temp-workspace.ts` has 90-odd importers — and this is
 * the same move.
 */
import type { MemoryAdapter } from "@theokit/sdk";

/**
 * A `MemoryAdapter` that is available, declares no capability, and does nothing.
 *
 * @param overrides - Fields to replace. Present from the start because the copies already differed
 *   in intent even where they did not differ in bytes: a test that wants `write` to throw should say
 *   so here rather than copy the factory to change one line.
 */
export function stubMemoryAdapter(overrides: Partial<MemoryAdapter> = {}): MemoryAdapter {
  return {
    id: "spy",
    capabilities: {
      history: false,
      sessions: false,
      tenancy: false,
      reasoning: false,
      toolSchemas: false,
      prefetch: false,
    },
    isAvailable: () => true,
    write: async () => "spy:noop" as never,
    recall: async () => [],
    delete: async () => undefined,
    ...overrides,
  };
}
