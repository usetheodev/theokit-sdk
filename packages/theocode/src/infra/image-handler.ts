/**
 * `image-handler` — image detection and base64 encoding.
 *
 * EC-3: rejects 0-byte files, >10MB files, and non-image extensions.
 */

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Detect MIME type from file extension. Returns null for non-image extensions.
 */
export function detectImageType(path: string): string | null {
  const ext = extname(path).toLowerCase();
  return MIME_MAP[ext] ?? null;
}

/**
 * Read an image file and return its base64-encoded content + MIME type.
 * EC-3: rejects 0-byte, >10MB, and non-image extensions.
 */
export function imageToBase64(
  path: string,
): { ok: true; base64: string; mimeType: string } | { ok: false; error: string } {
  const mimeType = detectImageType(path);
  if (!mimeType) return { ok: false, error: `Unsupported image extension: ${extname(path)}` };

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    return { ok: false, error: `File not found: ${path}` };
  }

  if (stat.size === 0) return { ok: false, error: "File is empty (0 bytes)" };
  if (stat.size > MAX_SIZE)
    return { ok: false, error: `File exceeds 10MB limit (${stat.size} bytes)` };

  try {
    const buf = readFileSync(path);
    return { ok: true, base64: buf.toString("base64"), mimeType };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
