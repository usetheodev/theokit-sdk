/**
 * Shared memory file utilities.
 * Canonical implementation (consolidated from 220L duplicate).
 * @internal
 */

export function createMemoryFile(path: string, content = "") {
  return {
    path,
    content,
    metadata: {},
  };
}

export function saveMemoryFile(_file: any) {
  // Placeholder
}
