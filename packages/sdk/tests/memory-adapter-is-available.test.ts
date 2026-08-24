import { expect, it, vi } from "vitest";
import { buildAgentMemory } from "../src/internal/local-agent/local-agent-memory-direct.js";
import type { MemoryAdapter } from "../src/types/memory-adapter.js";

/*
 * #360 — `MemoryAdapter.isAvailable()` is required by the contract and was called by nothing.
 *
 * Every third-party adapter implements it as "is there a non-empty apiKey", so an implementer
 * reasonably assumes returning `false` disables the adapter. It did not: the client is built lazily
 * on first write/recall, so `mem0Memory({ apiKey: "" })` started normally and surfaced mid-
 * conversation as `MemoryAdapterError(code: "auth_failed")` — at the point where a memory write is
 * happening, not where the operator could still fix it.
 *
 * A mandatory probe that reads as a guarantee and provides none is worse than dead code, which is
 * why consulting it beats deleting it: it also gives a multi-adapter setup a way to fall back.
 */

function adapter(name: string, available: boolean, calls: string[]): MemoryAdapter {
  return {
    id: name,
    isAvailable: () => available,
    initialize: vi.fn(async () => {
      calls.push(`init:${name}`);
    }),
    write: vi.fn(async () => {
      calls.push(`write:${name}`);
      return `${name}-1`;
    }),
    recall: vi.fn(async () => []),
  } as unknown as MemoryAdapter;
}

function managerWith(...adapters: MemoryAdapter[]) {
  return {
    aggregated: {
      memoryProviders: adapters.map((a, i) => ({
        pluginName: `plugin-${i}`,
        createProvider: async () => a,
      })),
    },
  };
}

it("skips an adapter that reports itself unavailable", async () => {
  const calls: string[] = [];
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const memory = buildAgentMemory(
    managerWith(adapter("mem0", false, calls), adapter("honcho", true, calls)) as never,
    "/tmp",
    { userId: "u-1" },
  );

  await memory.write("remember this");

  expect(calls).toEqual(["init:honcho", "write:honcho"]);
  expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toContain("mem0");
});

it("refuses the write when EVERY adapter is unavailable", async () => {
  // Fail-fast rather than silently succeeding: a `write` that resolves without storing anything is
  // the swallowed-error shape `error-handling.md` § 5 forbids, and the caller cannot tell.
  const calls: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const memory = buildAgentMemory(managerWith(adapter("mem0", false, calls)) as never, "/tmp", {
    userId: "u-1",
  });

  await expect(memory.write("remember this")).rejects.toThrow(
    /All 1 registered memory adapter\(s\) reported themselves unavailable/,
  );

  // The other branch keeps its own message: "add a plugin" and "fix the key on the plugin you
  // already added" are different instructions, and one text for both sends half the readers wrong.
  const empty = buildAgentMemory(managerWith() as never, "/tmp", { userId: "u-1" });
  await expect(empty.write("x")).rejects.toThrow(/No memory adapter registered/);
});

it("uses every adapter that reports itself available", async () => {
  // The accepted case (`testing.md` § 4.2). A gate that skipped everything would satisfy both tests
  // above while disabling memory entirely.
  const calls: string[] = [];
  const memory = buildAgentMemory(
    managerWith(adapter("mem0", true, calls), adapter("honcho", true, calls)) as never,
    "/tmp",
    { userId: "u-1" },
  );

  await memory.write("remember this");

  expect(calls).toEqual(["init:mem0", "init:honcho", "write:mem0", "write:honcho"]);
});
