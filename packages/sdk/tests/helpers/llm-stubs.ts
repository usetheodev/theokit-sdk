/**
 * The minimal `LlmClient`, in one place.
 *
 * Twenty-six test files each construct their own inline `LlmClient` stub, under four different names
 * (`fake`, `stub`, `mock`, `test`), and two of them — `strip-think-wiring.test.ts` and
 * `error-packaging.test.ts` — were byte-identical, the second admitting the copy in its docblock
 * ("same injection pattern as..."). All of them encode the same two facts: what an `LlmClient` is,
 * and what an `LlmFinish` envelope must carry. Change `LlmFinish` and every one of them needs the
 * same edit.
 *
 * This is the single factory. `agent-loop-driver.ts` builds its recording stub on it rather than
 * declaring a second one, so "the minimal LlmClient" has one definition rather than two helpers'
 * worth.
 *
 * A `makeThrowingLlm` was drafted here and removed before it shipped: nothing imported it, and a
 * helper written for a caller that does not exist is the first rung of the parsimony ladder. Add it
 * when a test needs it, shaped by that test.
 */
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "../../src/internal/llm/types.js";

export interface TextLlmOptions {
  /** Called with every request the loop sends, in order. The seam wiring assertions need. */
  onRequest?: (request: LlmRequest) => void;
  /** Reported on the finish envelope. Omitted entirely when not given, which is not the same as 0. */
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * A client that streams `content` as one `text_delta` and finishes with `end_turn`.
 *
 * @param content - The whole reply.
 * @param options - See {@link TextLlmOptions}. Token fields are omitted rather than defaulted,
 *   because a stub reporting `outputTokens: 0` asserts something a budget test may be reading.
 */
export function makeTextLlm(content: string, options: TextLlmOptions = {}): LlmClient {
  return {
    name: "stub",
    async *stream(request: LlmRequest): AsyncGenerator<LlmEvent, LlmFinish, void> {
      options.onRequest?.(request);
      yield { type: "text_delta", text: content };
      return {
        stopReason: "end_turn",
        text: content,
        toolCalls: [],
        ...(options.inputTokens === undefined ? {} : { inputTokens: options.inputTokens }),
        ...(options.outputTokens === undefined ? {} : { outputTokens: options.outputTokens }),
      };
    },
  };
}
