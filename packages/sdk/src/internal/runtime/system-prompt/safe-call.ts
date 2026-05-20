/**
 * Try/catch wrapper that catches BOTH synchronous throws AND async rejections.
 * On error, writes a one-line diagnostic to stderr and returns `fallback`.
 *
 * Used by:
 *   - `SystemPromptPipeline` — each provider's `contribute` is wrapped so a
 *     broken provider cannot crash the run (ADR D8).
 *   - The real agent loop — `SendOptions.onStep` / `onDelta` callbacks are
 *     wrapped so a user callback throwing cannot abort the LLM run (ADR D1).
 *   - `LocalAgent.send` memory read — corrupt memory file degrades gracefully
 *     (edge-case review EC-4).
 *
 * @internal
 */
export async function safeCall<T>(
  fn: () => T | Promise<T>,
  fallback: T,
  label = "safeCall",
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] ${label} failed: ${message}\n`);
    return fallback;
  }
}
