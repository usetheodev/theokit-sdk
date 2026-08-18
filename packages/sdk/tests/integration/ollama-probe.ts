/**
 * One probe for "is this Ollama model actually pulled?", shared by the three
 * `ollama-*` integration suites.
 *
 * B-096 — each suite used to carry its own gate and they did not agree.
 * `ollama-tool-call` and `ollama-embedding-end-to-end` probed for the MODEL;
 * `ollama-end-to-end` probed only that the SERVER answered. So on a machine
 * with Ollama running and a different model pulled, that third suite ran
 * against a model the server does not have and failed on empty content
 * instead of skipping — a failure invisible on every machine without Ollama,
 * which is why it surfaced as a phantom regression in an unrelated batch.
 */

/** Default host, overridable exactly as the suites already document. */
export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/**
 * True when the server answers AND reports a model whose name starts with
 * `modelTag`. Any failure — unreachable, non-2xx, unparseable, timeout —
 * is false: the suites gate on this, and "cannot tell" must skip, never run.
 */
export async function probeOllamaModel(
  modelTag: string,
  host: string = OLLAMA_HOST,
  timeoutMs = 1000,
): Promise<boolean> {
  try {
    const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return false;
    const body = (await r.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).some((m) => (m.name ?? "").startsWith(modelTag));
  } catch {
    return false;
  }
}

/** `ollama/llama3.2:3b` → `llama3.2:3b`. The suites configure the former. */
export function serverModelName(configured: string): string {
  return configured.replace(/^ollama\//, "");
}
