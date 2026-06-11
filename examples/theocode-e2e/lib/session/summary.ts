type CallLlm = (system: string, user: string) => Promise<string>;

const TITLE_SYSTEM_PROMPT =
  "Generate a short, descriptive title (max 60 chars) for the following conversation. Return ONLY the title text, no quotes or explanation.";

/**
 * Generates a concise title for a session based on its messages.
 * Falls back to "Untitled Session" on LLM error.
 */
export async function generateTitle(
  messages: ReadonlyArray<{ role: string; content: string }>,
  callLlm: CallLlm,
): Promise<string> {
  if (messages.length === 0) return "Untitled Session";

  const conversationText = messages
    .slice(0, 10) // Use at most 10 messages for title generation
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  try {
    const title = await callLlm(TITLE_SYSTEM_PROMPT, conversationText);
    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed : "Untitled Session";
  } catch {
    return "Untitled Session";
  }
}
