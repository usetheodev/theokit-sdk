/**
 * M93/M1 — the behavioral test the shape gate was not.
 *
 * M93's first version checked error-path persistence by regex over the source, and
 * declared that honestly. Adversarial review measured the cost of that honesty: dead-coding the
 * call (`void 0 && persistTurnToTranscript(...)`) left all 5 tests **green**. A gate that
 * cannot tell a live call from a disabled one is not a gate.
 *
 * And the behavioral test WAS writable: `SessionStore` is declared "the pluggable session-store
 * seam. Exactly two methods" (`types/session-store.ts:34`) — the DIP seam exists precisely to
 * this substitution, and `safeConversation` only needs `run.conversation()`. Declining to use it was a
 * choice, not a limitation.
 */
import { describe, expect, it, vi } from "vitest";
import { runPostRunLifecycle } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";
import type { Run } from "../src/types/run.js";
import type { SessionRecord, SessionStore } from "../src/types/session-store.js";

/** In-memory store — the port has two methods, and this is what it exists for. */
function inMemoryStore(): SessionStore & { written: SessionRecord[] } {
  const written: SessionRecord[] = [];
  return {
    written,
    readRecords: async () => written,
    appendRecords: async (_id: string, records: SessionRecord[]) => {
      written.push(...records);
    },
  } as SessionStore & { written: SessionRecord[] };
}

/** A run whose `wait()` rejects — the 429 after N tool calls — but which HAS already produced conversation. */
function runFailingWithPartial(partial: unknown[]): Run {
  return {
    wait: async () => {
      throw new Error("429 rate limited after 8 tool calls");
    },
    conversation: async () => partial,
  } as unknown as Run;
}

const inert = {
  hooksExecutor: { run: async () => undefined } as never,
};

describe("M93/M1 — the error path genuinely persists", () => {
  it("a failing turn LEAVES the partial in the store", async () => {
    const store = inMemoryStore();
    await runPostRunLifecycle({
      run: runFailingWithPartial([
        { role: "assistant", content: [{ type: "text", text: "partial" }] },
      ]),
      userText: "oi",
      agentId: "ag-1",
      workspaceCwd: process.cwd(),
      sessionStore: store,
      model: "claude-sonnet-4-5",
      ...inert,
    });
    // Before M93 this was 0: `flushSessionWrites` drained an empty set, because
    // `persistTurnToTranscript` was only called later, at a point the error never reached.
    expect(store.written.length, "nothing was persisted on the error path").toBeGreaterThan(0);
    expect(JSON.stringify(store.written)).toContain("oi");
  });

  it("a WRITE failure neither masks the provider error nor escapes", async () => {
    const brokenStore = {
      readRecords: async () => [],
      appendRecords: async () => {
        throw new Error("disk full");
      },
    } as unknown as SessionStore;
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await expect(
        runPostRunLifecycle({
          run: runFailingWithPartial([{ role: "assistant", content: [] }]),
          userText: "oi",
          agentId: "ag-2",
          workspaceCwd: process.cwd(),
          sessionStore: brokenStore,
          model: "claude-sonnet-4-5",
          ...inert,
        }),
      ).resolves.toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });
});
