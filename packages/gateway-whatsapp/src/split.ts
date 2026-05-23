/**
 * Split a long string into ≤4096-char chunks for WhatsApp messages (ADR D310).
 *
 * Break preference: `\n\n` → `\n` → ` `. UTF-16 surrogate-pair guard.
 *
 * EC-8 absorbed: empty parts are filtered out at the end so consecutive
 * newlines don't produce empty `sendMessage` calls Meta would reject.
 *
 * @internal
 */

const WHATSAPP_MAX_TEXT = 4096;

export function splitForWhatsApp(text: string): string[] {
  const trimmed = text;
  if (trimmed.length <= WHATSAPP_MAX_TEXT) {
    const single = trimmed.trim();
    return single.length > 0 ? [single] : [];
  }
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > WHATSAPP_MAX_TEXT) {
    let cut = remaining.lastIndexOf("\n\n", WHATSAPP_MAX_TEXT);
    if (cut < WHATSAPP_MAX_TEXT * 0.5) cut = remaining.lastIndexOf("\n", WHATSAPP_MAX_TEXT);
    if (cut < WHATSAPP_MAX_TEXT * 0.5) cut = remaining.lastIndexOf(" ", WHATSAPP_MAX_TEXT);
    if (cut <= 0) cut = WHATSAPP_MAX_TEXT;
    // UTF-16 surrogate-pair guard: don't split inside an emoji.
    if (cut < remaining.length) {
      const code = remaining.charCodeAt(cut);
      if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
    }
    if (cut <= 0) cut = WHATSAPP_MAX_TEXT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\s]+/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  // EC-8: filter empty / whitespace-only parts.
  return chunks.map((p) => p.trim()).filter((p) => p.length > 0);
}
