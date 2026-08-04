/**
 * M76 T3.1 — the asker comes from the run's CONTEXT, not from a value pinned at construction.
 *
 * ## O desenho estava escrito por quem construiu o SDK
 *
 * A doc de `CustomTool.handler` descreve este caso de uso em duas frases:
 *
 * > *"M7 — the same `ctx` also carries an optional user `context` (provided once via
 * > `SendOptions.context`), so shared config like a `projectRoot` **is read by every tool instead of
 * > baked into each factory**."*
 * >
 * > *"#119 — `ctx.threadId` is the run's session identity (…), so **a stateful tool shared across
 * > sessions can scope its state per session instead of leaking it**."*
 *
 * "baked into each factory" is literally today's `askUser`; "leaking it across sessions" is
 * literally the consumer's module singleton. The two phrases name M76's two defects.
 *
 * ## What it does NOT solve, and why that is written here
 *
 * `ContextualTool.__requiredContext` is `"Phantom — never present at runtime"`. The name suggests it
 * carries context; it carries only TYPE. Pointing at it would have produced a recommendation that
 * does not implement — the risk `/discover-edge-cases` named (EC-1) before implementation
 * began.
 *
 * ## The negative case is mandatory
 *
 * With no asker at all, the tool **must not** return a promise that never resolves: the turn would stall until the
 * timeout de 5 minutos. `error-handling.md` § 2 exige erro tipado, e ele precisa ser IMEDIATO.
 */
import { describe, expect, it } from "vitest";

import { createQuestionTool } from "../src/question.js";

describe("M76 T3.1 — o asker vem do contexto", () => {
  it("test_asker_do_contexto_vence_o_da_fabrica", async () => {
    let fromFactory = 0;
    let doContexto = 0;
    const t = createQuestionTool({
      askUser: async () => {
        fromFactory++;
        return "fabrica";
      },
    });

    const out = await t.handler(
      { question: "qual?" },
      {
        context: {
          askUser: async () => {
            doContexto++;
            return "contexto";
          },
        },
      },
    );

    // Counting CAUSE, not inspecting text: it proves which function ran.
    expect(doContexto, "o asker do contexto tem de ser o chamado").toBe(1);
    expect(fromFactory, "the factory one must NOT be called when one exists in the context").toBe(
      0,
    );
    expect(out).toContain("contexto");
  });

  it("test_sem_contexto_usa_o_da_fabrica", async () => {
    // Backward compatibility: callers already building with `askUser` are unaffected.
    let fromFactory = 0;
    const t = createQuestionTool({
      askUser: async () => {
        fromFactory++;
        return "fabrica";
      },
    });
    const out = await t.handler({ question: "qual?" });
    expect(fromFactory).toBe(1);
    expect(out).toContain("fabrica");
  });

  it("test_NEGATIVO_sem_asker_nenhum_erro_tipado_imediato", async () => {
    // Sem asker, o antigo desenho devolveria uma promise pendente e o turno pararia 5 minutos.
    const t = createQuestionTool({});
    const inicio = Date.now();
    const out = (await t.handler({ question: "qual?" })) as string;
    const elapsed = Date.now() - inicio;

    const parsed = JSON.parse(out) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error, "the error must be TYPED, not free-form prose").toBe("no_asker");
    // Immediacy is not a detail: it is the reason the consumer's `"busy"` exists.
    expect(elapsed, "must resolve immediately, not wait for the timeout").toBeLessThan(100);
  });

  it("test_contexto_sem_askUser_cai_no_da_fabrica", async () => {
    // COUNTER-PROOF: a `context` present but without `askUser` must not be mistaken for "an asker exists".
    // Without this, an implementation checking only `ctx.context != null` would pass the tests above.
    let fromFactory = 0;
    const t = createQuestionTool({
      askUser: async () => {
        fromFactory++;
        return "fabrica";
      },
    });
    await t.handler({ question: "q" }, { context: { projectRoot: "/tmp" } });
    expect(fromFactory).toBe(1);
  });

  it("test_handler_e_reentrante_duas_chamadas_simultaneas_nao_se_contaminam", async () => {
    // M76 review (H3) — the previous NAME ("askers from distinct threadIds do not mix") claimed
    // more than this test proves. It suggested the tool ISOLATES state per session; the tool has no
    // state at all. Each `handler` captures its asker in a local `const`, so the non-mixing here is
    // **by construction**, not by isolation — and a test that cannot fail certifies nothing.
    //
    // What it legitimately protects is REENTRANCY: if someone refactored `question.ts` to
    // cache the asker in a module-level `let` (the plausible optimization), two simultaneous calls
    // would start contaminating each other and this test would fail. It is a non-regression test, and the name now says
    // isso.
    //
    // The PER-SESSION isolation invariant — what actually justified killing the singleton — lives where
    // the state lives: `agents/interactive/ask-bridge.test.ts`, in the consumer. Here it would be vacuous.
    const t = createQuestionTool({});
    const chamadas: string[] = [];
    const asker = (tag: string) => async (): Promise<string> => {
      await new Promise((r) => setTimeout(r, 5));
      chamadas.push(tag);
      return tag;
    };

    const [a, b] = await Promise.all([
      t.handler({ question: "q" }, { threadId: "s1", context: { askUser: asker("s1") } }),
      t.handler({ question: "q" }, { threadId: "s2", context: { askUser: asker("s2") } }),
    ]);

    expect(chamadas.sort()).toEqual(["s1", "s2"]);
    expect(a).toContain("s1");
    expect(b).toContain("s2");
  });
});

/**
 * M76 review (HIGH-1 and MEDIUM-1) — the WIRING, not the capability.
 *
 * O review adversarial encontrou o defeito central do milestone: `AskBridge` suportava escopo por
 * session and the handler received `ctx.threadId`, but **the value was never forwarded**. The `Map` had one
 * key forever — `let pending` under another name. The earlier tests built the bridge by hand
 * and passed `'s1'`/`'s2'`: they proved the CLASS supports it, not that the SYSTEM uses it.
 *
 * These two test the link. Without them, unhooking it again would break nothing.
 */
describe("M76 review — threadId wiring and slot release", () => {
  it("test_o_threadId_do_ctx_CHEGA_ao_asker", async () => {
    const recebidos: (string | undefined)[] = [];
    const t = createQuestionTool({
      askUser: async (_q, threadId) => {
        recebidos.push(threadId);
        return "ok";
      },
    });

    await t.handler({ question: "q" }, { threadId: "sessao-42" });

    expect(
      recebidos[0],
      "the threadId did not reach the asker — the bridge Map would always fall into the default slot",
    ).toBe("sessao-42");
  });

  it("test_o_timeout_AVISA_que_a_pergunta_foi_abandonada", async () => {
    // Without this notice the slot stays occupied forever: the UI keeps showing an orphaned prompt and every
    // subsequent question gets "one is already pending" — a permanent error for something nobody awaits.
    const abandoned: (string | undefined)[] = [];
    const t = createQuestionTool({
      askUser: () => new Promise<string>(() => undefined), // nunca resolve
      timeoutMs: 20,
      onAbandon: (threadId) => abandoned.push(threadId),
    });

    const out = (await t.handler({ question: "q" }, { threadId: "s9" })) as string;

    expect(JSON.parse(out).error).toBe("timeout");
    expect(abandoned, "the timeout must release the session slot").toEqual(["s9"]);
  });
});
