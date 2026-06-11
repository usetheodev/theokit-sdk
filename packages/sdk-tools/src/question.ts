/**
 * `question` — interactive tool that asks the user a question and waits for a response.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, answer: string }`
 *   - `{ ok: false, error: "timeout" }`
 */

export interface QuestionToolOptions {
  /** Callback that presents a question to the user and resolves with their answer. */
  askUser: (question: string) => Promise<string>;
  /** Maximum time to wait for user response in ms. Default: 300_000 (5 min). */
  timeoutMs?: number;
}

export interface QuestionTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: { question: string }) => Promise<string>;
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
    handler: async (input: { question: string }): Promise<string> => {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });

      try {
        const answer = await Promise.race([opts.askUser(input.question), timeout]);
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
