import { afterEach, describe, expect, it, vi } from "vitest";

import { diag, setDiagnosticsSink } from "../src/internal/diagnostics.js";

/**
 * theokit-sdk#147 — a biblioteca não é dona do terminal.
 *
 * O SDK escrevia diagnósticos direto em `process.stderr` a partir de caminhos quentes (92 sítios
 * em 51 arquivos sob `internal/`). Numa host de TUI (Ink, alternate screen), essas escritas se
 * intercalam com o render e corrompem o frame — e o host **não tinha como interceptá-las**. Um
 * consumidor chegou a instalar `proper-lockfile` só para calar UMA delas.
 *
 * Estes testes travam o canal único e a interceptação. A virada do padrão para silencioso é
 * migração própria (58 arquivos de teste asseram o `stderr` hoje) — ver o comentário de
 * `diagnostics.ts`.
 */
describe("canal de diagnóstico interceptável (#147)", () => {
  afterEach(() => {
    setDiagnosticsSink(undefined);
    vi.restoreAllMocks();
  });

  it("sem sink, a mensagem vai para o stderr — comportamento inalterado", () => {
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    diag("[theokit-sdk] algo aconteceu\n");

    expect(escrever).toHaveBeenCalledWith("[theokit-sdk] algo aconteceu\n");
  });

  it("com sink instalado, a aplicação recebe a mensagem", () => {
    const recebidas: string[] = [];
    setDiagnosticsSink((m) => recebidas.push(m));

    diag("[theokit-sdk] recall falhou\n");

    expect(recebidas).toEqual(["[theokit-sdk] recall falhou\n"]);
  });

  it("com sink instalado, o stderr NÃO recebe cópia", () => {
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => undefined);

    // Duplicar destinos devolveria o problema à TUI que instalou o sink justamente para tirar
    // as mensagens do terminal — é o defeito relatado, de volta.
    diag("[theokit-sdk] x\n");

    expect(escrever).not.toHaveBeenCalled();
  });

  it("um sink vazio é o caminho de quem quer silêncio hoje", () => {
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => {
      /* descarta */
    });

    diag("[theokit-sdk] x\n");

    expect(escrever).not.toHaveBeenCalled();
  });

  it("remover o sink devolve o stderr", () => {
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => undefined);
    setDiagnosticsSink(undefined);

    diag("[theokit-sdk] x\n");

    expect(escrever).toHaveBeenCalledWith("[theokit-sdk] x\n");
  });

  it("um sink que lança não derruba o run que ele apenas observa", () => {
    setDiagnosticsSink(() => {
      throw new Error("sink quebrado");
    });

    expect(() => diag("[theokit-sdk] x\n")).not.toThrow();
  });
});
