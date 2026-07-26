/**
 * M77 T2.1 — o orçamento de contexto deixa de ser silencioso.
 *
 * ## O que existia
 *
 * Um `process.stderr.write` uma-vez-por-processo (`post-run-lifecycle.ts:113-124`), guardado por um
 * `Set` num símbolo global. Nenhuma superfície consegue reagir a isso: a TUI não lê stderr do próprio
 * processo, o exec headless não o correlaciona com o turn, e um segundo modelo desconhecido na mesma
 * sessão **não avisa nada** porque o `Set` já tem a chave.
 *
 * O canal certo já existe e tem um exemplo direto: `RunEvent` (`types/run-events.ts:19`), com
 * `compact_boundary` (`:107`) emitido por `emitRunEvent` no mesmo arquivo da decisão.
 *
 * ## O gate do comentário invertido
 *
 * `post-run-lifecycle.ts:108` dizia:
 *
 * > *"Missing usage/window ⇒ the trigger never fires (fail-safe)"*
 *
 * Está trocado. Não compactar quando não se sabe a janela deixa o contexto **crescer até o provider
 * recusar** — é fail-OPEN. Um comentário que chama de seguro o comportamento inseguro é pior que
 * comentário nenhum: ele encerra a investigação de quem leria o código procurando o defeito.
 * O último teste deste arquivo é o gate de veracidade, no precedente do M67
 * (`agents/m67-docs-truthfulness.test.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveEffectiveContextWindow } from "../src/compaction.js";
import { buildContextBudgetEvent } from "../src/internal/runtime/lifecycle/context-budget-event.js";
import type { RunEvent } from "../src/types/run-events.js";

describe("M77 T2.1 — evento estruturado de orçamento de contexto", () => {
  it("test_modelo_fora_do_catalogo_emite_compaction_fallback", () => {
    const resolved = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    const evento = buildContextBudgetEvent("openrouter/algum-modelo", resolved);

    expect(evento, "modelo desconhecido tem de produzir evento, não silêncio").toBeDefined();
    expect(evento?.type).toBe("compaction_fallback");
  });

  it("test_o_evento_carrega_o_MODELO_e_a_JANELA_assumida", () => {
    // Sem o modelo, a superfície não sabe QUAL configuração corrigir. Sem a janela, o usuário não
    // sabe contra o que está sendo medido — e o medidor volta a mentir, que é a DoD 6 deste mesmo
    // milestone.
    const resolved = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    const evento = buildContextBudgetEvent("openrouter/x", resolved);

    expect(evento?.model).toBe("openrouter/x");
    expect(evento?.window).toBe(121_600);
  });

  it("test_modelo_NO_catalogo_nao_emite_nenhum_dos_dois", () => {
    // CONTRAPROVA obrigatória: sem ela, uma implementação que emitisse sempre passaria nos dois
    // testes acima — e o evento viraria ruído que a superfície aprende a ignorar.
    const resolved = resolveEffectiveContextWindow({ catalog: 200_000, margin: 0.95 });
    expect(buildContextBudgetEvent("gpt-5.4", resolved)).toBeUndefined();
  });

  it("test_override_tambem_e_silencioso_pois_o_usuario_JA_sabe", () => {
    // O usuário que declarou a janela não precisa ser avisado de que ela foi usada.
    const resolved = resolveEffectiveContextWindow({ override: 50_000, margin: 0.95 });
    expect(buildContextBudgetEvent("qualquer", resolved)).toBeUndefined();
  });

  it("test_o_evento_e_uma_variante_LEGITIMA_de_RunEvent", () => {
    // Prova de tipo, não de execução: se `compaction_fallback` não fizesse parte da união `RunEvent`,
    // esta atribuição falharia na COMPILAÇÃO. É `tsc` que verifica, não o vitest.
    const resolved = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    const evento = buildContextBudgetEvent("m", resolved);
    if (evento !== undefined) {
      const comoRunEvent: RunEvent = evento;
      expect(comoRunEvent.type).toBe("compaction_fallback");
    }
  });

  it("test_o_comentario_de_post_run_lifecycle_nao_chama_mais_de_fail_safe", () => {
    // Gate de veracidade de docs — precedente M67. O comentário descrevia como "fail-safe" o
    // comportamento que faz o contexto estourar; quem lesse acreditaria que o silêncio era seguro.
    const fonte = readFileSync(
      join(import.meta.dirname, "../src/internal/runtime/lifecycle/post-run-lifecycle.ts"),
      "utf-8",
    );

    // A primeira versão deste gate proibia a STRING "fail-safe" e falhou contra o próprio fix: o
    // comentário corretivo CITA o termo errado para explicar que era errado. Proibir a palavra
    // proibiria também a correção — o oráculo tem de mirar a AFIRMAÇÃO, não o vocabulário.
    expect(
      /trigger never fires \(fail-safe\)/i.test(fonte),
      "a afirmação invertida voltou: desligar a compactação NÃO é fail-safe",
    ).toBe(false);

    // E a contraprova: sem ela, apagar o comentário inteiro passaria — e a lição some junto.
    expect(
      /fail-OPEN/.test(fonte),
      "a correção precisa estar escrita, não apenas a frase errada removida",
    ).toBe(true);
  });
});
