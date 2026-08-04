import { describe, expect, it } from "vitest";

/**
 * M93 T3.1 — o caminho de erro passa a persistir o transcript parcial.
 *
 * ## The defect, with exact evidence
 *
 * `runPostRunLifecycle` tinha um `catch` em torno de `run.wait()` que chamava `flushSessionWrites()` e
 * **returned**. The comment said "the mutex still releases via the flushes below" — true, and
 * irrelevant: `persistTurnToTranscript` is called **only later in the same function**, and it is the **only
 * caller in the whole repository** (measured by grep). Nothing had been queued, so the flush
 * drenava um conjunto **vazio**.
 *
 * A 429 after eight tool calls destroyed the turn **leaving nothing on disk**. Combined with the
 * absent retry on the single-key path — M93's other half — the loss was total: the turn
 * failed, was not retried, and left no trace to resume from.
 *
 * ## Why the test checks STRUCTURE and does not drive the lifecycle
 *
 * `runPostRunLifecycle` exige um `Run` real, um `SessionStore`, um `hooksExecutor`, um `memoryGlue` e
 * a `memoryProvider` — assembling all of that in a unit test would rebuild half the runtime, and the
 * result would measure my double, not the code. The invariant that matters is directly checkable: the
 * `catch` chama `persistTurnToTranscript` **antes** do `return`.
 *
 * It is a shape gate, and this says so rather than pretending it is behavioral. What makes it non-vacuous is the
 * ordem: ele falha se a chamada sair, e falha se ela for movida para depois do `return`.
 */
const fonte = (): string => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(
    new URL("../src/internal/runtime/lifecycle/post-run-lifecycle.ts", import.meta.url),
    "utf8",
  );
};

/** The body of the `catch` wrapping `run.wait()`, up to the `return` that ends it. */
const corpoDoCatch = (): string => {
  const src = fonte();
  const i = src.indexOf("result = await run.wait();");
  const j = src.indexOf("return;", i);
  return src.slice(i, j);
};

describe("M93 — o caminho de erro persiste o transcript parcial", () => {
  it("o catch chama persistTurnToTranscript ANTES do return", () => {
    expect(corpoDoCatch()).toContain("persistTurnToTranscript");
  });

  it("persiste o PARCIAL do run, nao um turno reconstruido", () => {
    // `safeConversation(run)` returns what the turn actually produced — user + completed tool calls.
    // Reconstructing the rest would be inventing history, which is worse than the loss.
    expect(corpoDoCatch()).toContain("safeConversation(run)");
  });

  it("a falha ao gravar NAO mascara o erro do turno", () => {
    // The inner `catch` exists because the caller is waiting on the provider's error, not a disk
    // error on top of it (`error-handling.md`: cleanup does not propagate over the original error).
    const corpo = corpoDoCatch();
    expect(corpo).toContain("partial transcript write failed");
  });

  it("o flush continua acontecendo — o mutex ainda libera", () => {
    expect(corpoDoCatch()).toContain("flushSessionWrites()");
  });

  it("CONTRAPROVA — o caminho de SUCESSO continua com sua propria persistencia", () => {
    // The happy-path call was neither moved nor duplicated: there are two, one on each path.
    const ocorrencias = fonte().match(/persistTurnToTranscript\(/g) ?? [];
    expect(ocorrencias).toHaveLength(2);
  });
});
