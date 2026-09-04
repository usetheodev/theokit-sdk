/**
 * Shared markdown chunking logic.
 * Canonical implementation (consolidated from 253L duplicate).
 * @internal
 */

export function chunkMarkdown(content: string, chunkSize = 1000) {
  const chunks = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
  return chunks;
}
