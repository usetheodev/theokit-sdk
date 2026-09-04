/**
 * Shared Anthropic stream test helpers.
 * Consolidates 138L from anthropic-stream.test.ts (3 sites).
 * @internal
 */
export function buildStreamTestMessage(overrides?: Record<string, any>) {
  return {
    type: "message_start",
    message: { id: "msg_123", content: [] },
    ...overrides,
  };
}
