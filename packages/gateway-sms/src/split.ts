/**
 * `splitForSMS` — grapheme-cluster-safe multipart segmentation (D393, EC-7).
 *
 * Concatenated SMS (UDH) on modern carriers reassemble at the recipient,
 * but each TCP/IP-layer chunk is one billed message. We segment at
 * 1600 chars (default) so the API call doesn't reject and each part is
 * prefixed with `(i/N) ` to allow manual reordering when carriers
 * deliver out of sequence (EC-7).
 *
 * Uses `Intl.Segmenter` (Node 22+) so emoji (🇧🇷) and combining
 * sequences are never severed.
 *
 * @internal
 */

const PART_PREFIX_RESERVED = 8; // "(99/99) " worst case

export function splitForSMS(text: string, limit = 1600): string[] {
  if (text.length === 0) return [""];
  if (text.length <= limit) return [text];

  // Walk graphemes; build parts up to (limit - reserved).
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(text), (s) => s.segment);
  const parts: string[] = [];
  const cap = limit - PART_PREFIX_RESERVED;
  let buf = "";
  for (const seg of segments) {
    // If adding `seg` would exceed cap, flush.
    if (buf.length + seg.length > cap) {
      if (buf.length > 0) parts.push(buf);
      buf = "";
    }
    buf += seg;
  }
  if (buf.length > 0) parts.push(buf);

  if (parts.length === 1) {
    // Short enough to skip prefix.
    return parts;
  }

  const total = parts.length;
  return parts.map((p, i) => `(${i + 1}/${total}) ${p}`);
}
