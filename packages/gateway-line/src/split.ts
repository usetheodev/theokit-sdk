/**
 * Grapheme-cluster-safe split for LINE outbound text (D411, EC-7).
 *
 * LINE limits text messages to 5000 chars. We segment with `Intl.Segmenter`
 * so emoji, regional indicators, and combining sequences are never
 * severed.
 */

export function splitForLine(text: string, limit = 5000): string[] {
  if (text.length === 0) return [""];
  if (text.length <= limit) return [text];

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(text), (s) => s.segment);
  const parts: string[] = [];
  let buf = "";
  for (const seg of segments) {
    if (buf.length + seg.length > limit) {
      if (buf.length > 0) parts.push(buf);
      buf = "";
    }
    buf += seg;
  }
  if (buf.length > 0) parts.push(buf);
  return parts;
}
