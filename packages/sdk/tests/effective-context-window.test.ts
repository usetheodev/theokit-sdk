/**
 * M77 T1.1 — a janela EFETIVA: override clampado + margem percentual.
 *
 * ## Por que isto existe
 *
 * `post-run-lifecycle.ts:110` lê `getCatalogModelInfo(model)?.limit?.context` e, quando é
 * `undefined`, **desliga a compactação**. O comentário duas linhas acima chama isso de `fail-safe`;
 * está invertido — desligar a compactação faz o contexto **estourar**. É fail-OPEN.
 *
 * ## O que a referência única (Codex) faz, e o que ela NÃO faz
 *
 * O Codex **não tem fallback**: `core/src/session/turn_context.rs:213` devolve `Option<i64>` e os
 * consumidores dão early-return (`core/src/compact_remote.rs:374`). Nisso estamos em paridade.
 *
 * Mas ele tem duas técnicas que nós não temos:
 *
 *  - **override clampado** — `models-manager/src/model_info.rs:26-31` deixa a config sobrepor o
 *    catálogo, mas limita por `max_context_window` (`context_window.min(max_context_window)`);
 *  - **margem percentual** — `model_info.rs:158`, `effective_context_window_percent: 95`. O Codex
 *    nunca usa 100% da janela.
 *
 * O clamp é a metade que o ROADMAP omite, e sem ele o override vira uma segunda porta para o
 * estouro: o usuário declara 999k num modelo de 200k e o gatilho nunca dispara.
 *
 * ## Por que margem, e não o piso fixo de 128k que o ROADMAP sugere
 *
 * `shouldCompact` (`compaction.ts:304`) é monotônico decrescente na janela: subestimar compacta cedo
 * (seguro), superestimar estoura. Um piso de 128k é conservador **só para cima** — num modelo de 8k
 * ele compacta tarde demais e estoura igual ao silêncio de hoje, com a aparência de proteção. A
 * margem multiplicativa funciona para QUALQUER janela; o piso só entra quando não há janela alguma.
 */
import { describe, expect, it } from "vitest";

import { ContextWindowMarginError, resolveEffectiveContextWindow } from "../src/compaction.js";

describe("M77 T1.1 — janela efetiva", () => {
  it("test_override_menor_que_o_catalogo_vence", () => {
    // O caso de uso primário: o usuário sabe que quer trabalhar num orçamento menor.
    const r = resolveEffectiveContextWindow({ override: 50_000, catalog: 200_000, margin: 0.95 });
    expect(r.window).toBe(47_500);
    expect(r.source).toBe("override");
  });

  it("test_override_maior_que_o_maximo_e_CLAMPADO", () => {
    // A metade que o ROADMAP omite. Sem o clamp, declarar 999k num modelo de 200k reintroduz o
    // estouro por outra porta — e em silêncio, que é o pior modo.
    const r = resolveEffectiveContextWindow({ override: 999_000, catalog: 200_000, margin: 0.95 });
    expect(r.window, "o override tem de ser limitado pelo máximo real do modelo").toBe(190_000);
    expect(r.clamped, "e o clamp precisa ser VISÍVEL, não silencioso").toBe(true);
  });

  it("test_sem_override_usa_catalogo_com_margem", () => {
    const r = resolveEffectiveContextWindow({ catalog: 200_000, margin: 0.95 });
    expect(r.window).toBe(190_000);
    expect(r.source).toBe("catalog");
  });

  it("test_sem_catalogo_e_sem_override_devolve_o_PISO_e_nao_desliga", () => {
    // O coração do milestone: hoje este caminho devolve `undefined` e a compactação MORRE. Agora
    // devolve um piso e a compactação segue viva.
    const r = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    expect(r.window).toBe(121_600);
    expect(r.source, "a origem precisa ser identificável para o evento estruturado").toBe(
      "fallback",
    );
  });

  it("test_margem_invalida_e_erro_TIPADO_e_nao_silencio", () => {
    // `rules/error-handling.md § 2`: erro tipado, não valor mágico. Uma margem > 1 aumentaria a
    // janela assumida — exatamente a direção insegura.
    expect(() => resolveEffectiveContextWindow({ catalog: 200_000, margin: 1.5 })).toThrow(
      ContextWindowMarginError,
    );
    expect(() => resolveEffectiveContextWindow({ catalog: 200_000, margin: 0 })).toThrow(
      ContextWindowMarginError,
    );
  });

  it("test_CONTRAPROVA_margem_1_nao_encolhe_a_janela", () => {
    // Sem esta, uma implementação que ignorasse `margin` e devolvesse o catálogo cru passaria em
    // parte dos testes acima. Margem 1.0 é o único caso em que catálogo cru é a resposta certa.
    const r = resolveEffectiveContextWindow({ catalog: 200_000, margin: 1 });
    expect(r.window).toBe(200_000);
    expect(r.clamped).toBe(false);
  });

  it("test_o_piso_NAO_e_usado_quando_ha_catalogo", () => {
    // CONTRAPROVA do fallback: um piso que vencesse o catálogo faria um modelo de 8k ser tratado
    // como 128k — o fail-open que este milestone existe para fechar.
    const r = resolveEffectiveContextWindow({ catalog: 8_000, margin: 0.95, floor: 128_000 });
    expect(r.window, "modelo pequeno NÃO pode ser inflado pelo piso").toBe(7_600);
    expect(r.source).toBe("catalog");
  });
});
