/**
 * Consolidated error types (67L duplicate).
 * @internal
 */
export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

export const errorFactory = {
  MemoryError,
};
