/**
 * M77 T1.1 — a janela EFETIVA: override clampado + margem percentual.
 *
 * ## Por que isto existe
 *
 * `post-run-lifecycle.ts:110` reads `getCatalogModelInfo(model)?.limit?.context` and, when it is
 * `undefined`, **turns compaction off**. The comment two lines above calls that `fail-safe`;
 * it is inverted — turning compaction off makes the context **overflow**. It is fail-OPEN.
 *
 * ## What the single reference (Codex) does, and what it does NOT do
 *
 * Codex has **no fallback**: `core/src/session/turn_context.rs:213` returns `Option<i64>` and its
 * consumers early-return (`core/src/compact_remote.rs:374`). On that we are at parity.
 *
 * But it has two techniques we do not:
 *
 *  - **override clampado** — `models-manager/src/model_info.rs:26-31` deixa a config sobrepor o
 *    catalog, but bounds it by `max_context_window` (`context_window.min(max_context_window)`);
 *  - **margem percentual** — `model_info.rs:158`, `effective_context_window_percent: 95`. O Codex
 *    nunca usa 100% da janela.
 *
 * The clamp is the half the ROADMAP omits, and without it the override becomes a second door to
 * overflow: the user declares 999k on a 200k model and the trigger never fires.
 *
 * ## Why a margin, and not the fixed 128k floor the ROADMAP suggests
 *
 * `shouldCompact` (`compaction.ts:304`) is monotonically decreasing in the window: underestimating compacts early
 * (safe), overestimating overflows. A 128k floor is conservative **only upwards** — on an 8k model
 * it compacts too late and overflows just like today's silence, wearing the appearance of protection. The
 * multiplicative margin works for ANY window; the floor only applies when there is no window at all.
 */
import { describe, expect, it } from "vitest";

import { ContextWindowMarginError, resolveEffectiveContextWindow } from "../src/compaction.js";

describe("M77 T1.1 — janela efetiva", () => {
  it("test_override_menor_que_o_catalogo_vence", () => {
    // The primary use case: the user knows they want to work within a smaller budget.
    const r = resolveEffectiveContextWindow({ override: 50_000, catalog: 200_000, margin: 0.95 });
    expect(r.window).toBe(47_500);
    expect(r.source).toBe("override");
  });

  it("test_override_maior_que_o_maximo_e_CLAMPADO", () => {
    // A metade que o ROADMAP omite. Sem o clamp, declarar 999k num modelo de 200k reintroduz o
    // overflow through another door — and silently, which is the worst mode.
    const r = resolveEffectiveContextWindow({ override: 999_000, catalog: 200_000, margin: 0.95 });
    expect(r.window, "the override must be bounded by the model's real maximum").toBe(190_000);
    expect(r.clamped, "and the clamp must be VISIBLE, not silent").toBe(true);
  });

  it("test_sem_override_usa_catalogo_com_margem", () => {
    const r = resolveEffectiveContextWindow({ catalog: 200_000, margin: 0.95 });
    expect(r.window).toBe(190_000);
    expect(r.source).toBe("catalog");
  });

  it("test_sem_catalogo_e_sem_override_devolve_o_PISO_e_nao_desliga", () => {
    // The heart of the milestone: today this path returns `undefined` and compaction DIES. Now
    // it returns a floor and compaction stays alive.
    const r = resolveEffectiveContextWindow({ margin: 0.95, floor: 128_000 });
    expect(r.window).toBe(121_600);
    expect(r.source, "the origin must be identifiable for the structured event").toBe("fallback");
  });

  it("test_margem_invalida_e_erro_TIPADO_e_nao_silencio", () => {
    // `rules/error-handling.md` § 2: a typed error, not a magic value. A margin > 1 would increase the
    // assumed window — exactly the unsafe direction.
    expect(() => resolveEffectiveContextWindow({ catalog: 200_000, margin: 1.5 })).toThrow(
      ContextWindowMarginError,
    );
    expect(() => resolveEffectiveContextWindow({ catalog: 200_000, margin: 0 })).toThrow(
      ContextWindowMarginError,
    );
  });

  it("test_CONTRAPROVA_margem_1_nao_encolhe_a_janela", () => {
    // Without this, an implementation ignoring `margin` and returning the raw catalog would pass
    // some of the tests above. Margin 1.0 is the only case where the raw catalog is the right answer.
    const r = resolveEffectiveContextWindow({ catalog: 200_000, margin: 1 });
    expect(r.window).toBe(200_000);
    expect(r.clamped).toBe(false);
  });

  it("test_o_piso_NAO_e_usado_quando_ha_catalogo", () => {
    // COUNTER-PROOF of the fallback: a floor that beat the catalog would make an 8k model be treated
    // como 128k — o fail-open que este milestone existe para fechar.
    const r = resolveEffectiveContextWindow({ catalog: 8_000, margin: 0.95, floor: 128_000 });
    expect(r.window, "a small model must NOT be inflated by the floor").toBe(7_600);
    expect(r.source).toBe("catalog");
  });
});
