/**
 * M94 Fase 2 — a janela declarada na definição atravessa até o orçamento.
 *
 * `resolveEffectiveContextWindow` aceita `override` desde o M77, e o ÚNICO call site de produção
 * (`post-run-lifecycle.ts:149`) nunca o passava. Sem entrada de catálogo — OpenRouter não tem —
 * a janela ficava presa no piso (128k × 0,95 = 121.600) mesmo num modelo de 400k: ~3× mais
 * compactação que o necessário, com chamadas extras de sumarizador e perda irreversível.
 *
 * ## Por que uma função pura em vez de um gate de forma
 *
 * A primeira versão deste arquivo afirmava `const sel: ModelSelection = {contextWindow}` e passava
 * — vitest não faz typecheck, então um campo inexistente não reprova nada em runtime. Os outros
 * três testes exercitavam `resolveEffectiveContextWindow` direto, que já funcionava desde o M77.
 * Quatro testes verdes e **zero** poder de detecção: a mesma classe do M92 BLOCKER-1.
 *
 * `resolveWindowForRun` existe para que a FIAÇÃO seja comportamento: ela é o que o lifecycle chama,
 * recebe o que o lifecycle tem em mãos, e um mutante que pare de repassar o override reprova aqui.
 */
import { describe, expect, it } from "vitest";
import { getCatalogModelInfo } from "../src/internal/providers/catalog-loader.js";
import { resolveWindowForRun } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";

/** Alguns ids reais; o teste exige que ao menos UM tenha entrada, senão o clamp fica sem prova. */
const MODELOS_CANDIDATOS = [
  "anthropic/claude-sonnet-4-5",
  "claude-sonnet-4-5",
  "openai/gpt-4o",
  "gpt-4o",
];

describe("M94 — resolveWindowForRun", () => {
  it("repassa o contextWindow da definição como override", () => {
    // Modelo sem catálogo (OpenRouter): antes do M94 caía no piso de 128k.
    const r = resolveWindowForRun("openrouter/modelo-de-400k", 400_000);
    expect(r.source).toBe("override");
    expect(r.window).toBeGreaterThan(300_000);
  });

  it("sem contextWindow declarado, o comportamento é byte-idêntico ao anterior", () => {
    const r = resolveWindowForRun("openrouter/modelo-desconhecido", undefined);
    expect(r.source).toBe("fallback");
    expect(r.window).toBe(Math.floor(128_000 * 0.95));
  });

  it("um override inflado É clampeado — a proteção do catálogo segue valendo", () => {
    // O guard tem de ser pela PRESENÇA no catálogo, não por `source`: com um override presente,
    // `source` nunca é "fallback" — o primeiro rascunho deste teste passava por engano por isso.
    const comCatalogo = MODELOS_CANDIDATOS.find(
      (m) => getCatalogModelInfo(m)?.limit?.context !== undefined,
    );
    expect(
      comCatalogo,
      "nenhum modelo de catálogo disponível — o clamp ficaria sem prova",
    ).toBeDefined();
    const janelaDoCatalogo = getCatalogModelInfo(comCatalogo as string)?.limit?.context as number;
    const r = resolveWindowForRun(comCatalogo as string, janelaDoCatalogo * 100);
    expect(r.clamped).toBe(true);
    expect(r.window).toBe(Math.floor(janelaDoCatalogo * 0.95));
  });

  it("contextWindow zero ou negativo é ignorado, não vira orçamento zero", () => {
    // Negativo/zero como override produziria um orçamento que dispara compactação a cada turno.
    expect(resolveWindowForRun("x/y", 0).source).toBe("fallback");
    expect(resolveWindowForRun("x/y", -1).source).toBe("fallback");
  });
});
