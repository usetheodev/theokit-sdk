import { vi } from "vitest";

/**
 * B-093 — some SDK entry points (cloud-runtime `Agent.create`, `Agent.compact`'s
 * disk-hydration-on-miss fallback) hardcode `process.cwd()` with no per-call override
 * (see `src/internal/cloud-agent/cloud-agent.ts:77`, `src/agent.ts` around the
 * `hydrateRegistryFromDisk(process.cwd())` calls). A test that needs one of those paths
 * to observe a per-test tmpdir used to reach for the real `process.chdir()` — which is a
 * process-wide OS syscall vitest's `threads` pool does not support ("process.chdir() is
 * not supported in workers"). The default gate runs under `pool: forks`, where chdir
 * happens to work, so the defect was invisible until something (e.g. Stryker's mutation
 * dry run) exercised the suite under a different pool.
 *
 * This spies on `process.cwd` instead of calling the real syscall: every in-process
 * reader of `process.cwd()` observes `dir` for the duration of `fn`, with no OS-level
 * cwd change and no worker-pool incompatibility. Restored unconditionally, so a thrown
 * assertion inside `fn` never leaks the mock into the next test.
 */
export async function withMockedCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(process, "cwd").mockReturnValue(dir);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}
