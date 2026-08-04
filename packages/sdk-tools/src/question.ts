/**
 * `question` — interactive tool that asks the user a question and waits for a response.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, answer: string }`
 *   - `{ ok: false, error: "timeout" }`
 */

export interface QuestionToolOptions {
  /**
   * Callback that presents the question to the user and resolves with the answer.
   *
   * M76 — passou a ser OPCIONAL: o asker preferencial vem do contexto da run
   * (`ctx.context.askUser`), because a value pinned here is the "baked into each factory" that the
   * `CustomTool.handler` aponta como o problema que `ctx.context` existe para resolver. Este campo
   * remains as a fallback, for callers building the tool with a fixed asker (backward-compatible).
   */
  askUser?: (question: string, threadId?: string) => Promise<string>;
  /**
   * Called when the question is ABANDONED (timeout or run cancellation), so the UI side can
   * release the slot. Without it the timeout leaves the question pending forever — the UI keeps showing
   * a prompt nobody is waiting on and the next question fails with "one is already pending".
   */
  onAbandon?: (threadId?: string) => void;
  /** Maximum time to wait for user response in ms. Default: 300_000 (5 min). */
  timeoutMs?: number;
  /**
   * M76 — nome exposto ao modelo. Omitido ⇒ `"question"` (aditivo).
   *
   * The consumer needed this: Codex calls the tool `request_user_input`, and without the option it
   * had to rebuild the whole object by hand — the two-cast adapter T3.3
   * eliminou.
   */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
}

/**
 * M76 — aligned with the SDK's `CustomTool`. It used to be its own interface with `inputSchema: unknown`, which
 * forced every consumer to write a cast to register the tool — and a cast does not fix a contract,
 * it only silences the compiler, turning a future signature change into a RUNTIME error.
 *
 * Narrowing was additive: the value has always been an object (`{ type: "object", properties, required }`
 * just below); only the declared type was loose. The handler accepts the contract's optional 2nd
 * argument (`ctx`), through which M76 now resolves the asker per session.
 */
export interface QuestionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * M76 — the input is `Record<string, unknown>`, not `{ question: string }`, by CONTRAVARIANCE: a
   * handler accepting only the narrow type is not assignable to one accepting the wide type, and `CustomTool`
   * SDK declares the wide one. Declaring narrow here forced the consumer into a cast — which was
   * exactly the defect. Narrowing happens INSIDE the handler, where validation lives.
   */
  handler: (
    input: Record<string, unknown>,
    ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
  ) => Promise<string>;
}

/**
 * Extrai o asker do contexto da run, se houver.
 *
 * `ctx.context` is `unknown` by contract — it is user data, and the SDK does not type it. A `context`
 * present but WITHOUT `askUser` (e.g. only `projectRoot`) must not be mistaken for "an asker exists": the
 * check is on the function, not on the object's presence.
 */
function askerDoContexto(
  context: unknown,
): ((question: string, threadId?: string) => Promise<string>) | undefined {
  if (typeof context !== "object" || context === null) return undefined;
  const candidato = (context as { askUser?: unknown }).askUser;
  return typeof candidato === "function"
    ? (candidato as (question: string, threadId?: string) => Promise<string>)
    : undefined;
}

export function createQuestionTool(opts: QuestionToolOptions): QuestionTool {
  const timeoutMs = opts.timeoutMs ?? 300_000;

  return {
    name: opts.name ?? "question",
    description:
      opts.description ??
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
      // M76 — precedence: run context > factory. `ctx.threadId` identifies the session, so a
      // tool shared across sessions now scopes the asker per session instead of leaking it.
      const askUser = askerDoContexto(ctx?.context) ?? opts.askUser;
      if (askUser === undefined) {
        // NEVER a pending promise: with no asker, waiting out the 5 min timeout would stall the whole turn
        // with nobody knowing why. Typed error, immediate (`error-handling.md` § 2).
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
        // M76 review — the `threadId` is FORWARDED to the asker. Without it the chain ctx.threadId -> bridge
        // did not exist: the bridge always fell into the default slot and the Map had one key forever — the
        // `let pending` under another name. The capability existed; the wiring did not.
        const answer = await Promise.race([
          askUser(String(input.question ?? ""), ctx?.threadId),
          timeout,
        ]);
        return JSON.stringify({ ok: true, answer });
      } catch (err) {
        if (err instanceof Error && err.message === "timeout") {
          // M76 review (MEDIUM-1) — tells the asker the question DIED. Without it the slot stayed
          // occupied forever: the UI kept rendering an orphaned prompt, and every subsequent question
          // got "one is already pending" — a permanent error for something nobody awaits anymore.
          opts.onAbandon?.(ctx?.threadId);
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
