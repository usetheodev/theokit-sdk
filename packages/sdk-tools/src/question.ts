/**
 * `question` — interactive tool that asks the user a question and waits for a response.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, answer: string }`
 *   - `{ ok: false, error: "timeout" }`
 */

export interface QuestionToolOptions {
  /**
   * Callback que apresenta a pergunta ao usuário e resolve com a resposta.
   *
   * M76 — passou a ser OPCIONAL: o asker preferencial vem do contexto da run
   * (`ctx.context.askUser`), porque um valor fixado aqui é o "baked into each factory" que a doc do
   * `CustomTool.handler` aponta como o problema que `ctx.context` existe para resolver. Este campo
   * permanece como fallback, para quem constrói a tool com um asker fixo (retrocompatível).
   */
  askUser?: (question: string) => Promise<string>;
  /** Maximum time to wait for user response in ms. Default: 300_000 (5 min). */
  timeoutMs?: number;
}

/**
 * M76 — alinhado ao `CustomTool` do SDK. Era uma interface própria com `inputSchema: unknown`, o que
 * obrigava todo consumidor a escrever um cast para registrar a tool — e cast não conserta contrato,
 * só silencia o compilador, transformando uma futura mudança de assinatura em erro de RUNTIME.
 *
 * Estreitar foi aditivo: o valor sempre foi um objeto (`{ type: "object", properties, required }`
 * logo abaixo); só o tipo declarado estava frouxo. O handler aceita o 2º argumento opcional do
 * contrato (`ctx`), por onde o M76 passa a resolver o asker por sessão.
 */
export interface QuestionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * M76 — o input é `Record<string, unknown>`, não `{ question: string }`, por CONTRAVARIÂNCIA: um
   * handler que aceita só o tipo estreito não é atribuível a um que aceita o largo, e o `CustomTool`
   * do SDK declara o largo. Declarar estreito aqui obrigava o consumidor a um cast — que era
   * exatamente o defeito. O estreitamento acontece DENTRO do handler, onde há validação.
   */
  handler: (
    input: Record<string, unknown>,
    ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
  ) => Promise<string>;
}

/**
 * Extrai o asker do contexto da run, se houver.
 *
 * `ctx.context` é `unknown` por contrato — é dado do usuário, e o SDK não o tipa. Um `context`
 * presente mas SEM `askUser` (ex.: só `projectRoot`) não pode ser confundido com "há asker": a
 * checagem é pela função, não pela presença do objeto.
 */
function askerDoContexto(context: unknown): ((question: string) => Promise<string>) | undefined {
  if (typeof context !== "object" || context === null) return undefined;
  const candidato = (context as { askUser?: unknown }).askUser;
  return typeof candidato === "function"
    ? (candidato as (question: string) => Promise<string>)
    : undefined;
}

export function createQuestionTool(opts: QuestionToolOptions): QuestionTool {
  const timeoutMs = opts.timeoutMs ?? 300_000;

  return {
    name: "question",
    description:
      "Ask the user a question and wait for their response. " +
      "Use when you need clarification or confirmation before proceeding. " +
      "Returns { ok, answer } or { ok: false, error: 'timeout' }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "The question to ask the user." },
      },
      required: ["question"],
    },
    handler: async (
      input: Record<string, unknown>,
      ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
    ): Promise<string> => {
      // M76 — precedência: contexto da run > fábrica. `ctx.threadId` identifica a sessão, então uma
      // tool compartilhada entre sessões passa a escopar o asker por sessão em vez de vazá-lo.
      const askUser = askerDoContexto(ctx?.context) ?? opts.askUser;
      if (askUser === undefined) {
        // NUNCA uma promise pendente: sem asker, esperar o timeout de 5 min pararia o turno inteiro
        // sem que ninguém soubesse por quê. Erro tipado, imediato (`error-handling.md` § 2).
        return JSON.stringify({
          ok: false,
          error: "no_asker",
          message:
            "No asker available: pass `askUser` to createQuestionTool, or provide " +
            "`context.askUser` via SendOptions.context.",
        });
      }
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });

      try {
        const answer = await Promise.race([askUser(String(input.question ?? "")), timeout]);
        return JSON.stringify({ ok: true, answer });
      } catch (err) {
        if (err instanceof Error && err.message === "timeout") {
          return JSON.stringify({
            ok: false,
            error: "timeout",
            message: "User did not respond within timeout.",
          });
        }
        throw err;
      }
    },
  };
}
