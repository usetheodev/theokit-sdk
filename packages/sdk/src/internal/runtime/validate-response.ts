/**
 * Validate-response helpers (T2.2, ADR D93).
 *
 * Detects empty-content + zero-toolCalls as a model-bailout signal. Weak
 * models (Gemini Flash, Mistral 7B) sometimes return content: "" with no
 * tool calls after a tool result; without detection, the loop would keep
 * spinning, inflating context and breaking prompt cache.
 *
 * NOTE on content type guarantee (EC-13): caller is responsible for
 * passing a string `content` (providers that return `{ text: "..." }` are
 * normalized in `internal/llm/*.ts`).
 *
 * @internal
 */

export interface ResponseValidation {
  ok: boolean;
  reason?: string;
}

export interface AssistantResponseShape {
  content: string;
  toolCalls: readonly unknown[];
}

/**
 * `{ ok: false }` when content is empty/whitespace AND toolCalls is empty.
 * Caller should consume an iteration budget unit and inject a nudge
 * user-message ("continue or end with a final answer").
 *
 * @internal
 */
export function validateResponse(response: AssistantResponseShape): ResponseValidation {
  const trimmed = response.content.trim();
  const toolCallsArr = Array.isArray(response.toolCalls) ? response.toolCalls : [];
  if (trimmed === "" && toolCallsArr.length === 0) {
    return {
      ok: false,
      reason: "empty response with no tool calls (model bailout)",
    };
  }
  return { ok: true };
}
