import { describe, expect, it } from "vitest";

/**
 * M93 T3.1 — o caminho de erro passa a persistir o transcript parcial.
 *
 * ## O defeito, com a evidência exata
 *
 * `runPostRunLifecycle` tinha um `catch` em torno de `run.wait()` que chamava `flushSessionWrites()` e
 * **retornava**. O comentário dizia "o mutex ainda libera pelos flushes abaixo" — verdade, e
 * irrelevante: `persistTurnToTranscript` é chamado **só mais adiante na mesma função**, e é o **único
 * chamador no repositório inteiro** (medido por grep). Nada havia sido enfileirado, então o flush
 * drenava um conjunto **vazio**.
 *
 * Um 429 depois de oito tool calls destruía o turno **sem deixar nada em disco**. Combinado com a
 * ausência de retry no caminho de chave única — a outra metade do M93 — a perda era total: o turno
 * falhava, não era reexecutado, e não deixava rastro para retomar.
 *
 * ## Por que o teste verifica a ESTRUTURA e não dirige o lifecycle
 *
 * `runPostRunLifecycle` exige um `Run` real, um `SessionStore`, um `hooksExecutor`, um `memoryGlue` e
 * um `memoryProvider` — montar tudo isso em teste unitário reconstruiria metade do runtime, e o
 * resultado mediria o meu duble, não o código. O invariante que importa é verificável direto: o
 * `catch` chama `persistTurnToTranscript` **antes** do `return`.
 *
 * É um gate de forma, e digo isso em vez de fingir que é comportamental. O que o torna não-vacuo é a
 * ordem: ele falha se a chamada sair, e falha se ela for movida para depois do `return`.
 */
const fonte = (): string => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(
    new URL("../src/internal/runtime/lifecycle/post-run-lifecycle.ts", import.meta.url),
    "utf8",
  );
};

/** O corpo do `catch` que envolve `run.wait()`, até o `return` que o encerra. */
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
    // `safeConversation(run)` devolve o que o turno de fato produziu — user + tool calls concluídas.
    // Reconstruir o resto seria inventar histórico, que é pior que a perda.
    expect(corpoDoCatch()).toContain("safeConversation(run)");
  });

  it("a falha ao gravar NAO mascara o erro do turno", () => {
    // O `catch` interno existe porque o chamador está esperando o erro do provider, não um erro de
    // disco por cima dele (`error-handling.md`: cleanup não propaga sobre o erro original).
    const corpo = corpoDoCatch();
    expect(corpo).toContain("partial transcript write failed");
  });

  it("o flush continua acontecendo — o mutex ainda libera", () => {
    expect(corpoDoCatch()).toContain("flushSessionWrites()");
  });

  it("CONTRAPROVA — o caminho de SUCESSO continua com sua propria persistencia", () => {
    // A chamada do caminho feliz não foi movida nem duplicada: existem duas, uma em cada caminho.
    const ocorrencias = fonte().match(/persistTurnToTranscript\(/g) ?? [];
    expect(ocorrencias).toHaveLength(2);
  });
});
