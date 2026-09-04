/**
 * Shared error mock factories.
 * @internal
 */

export function buildTestError(overrides?: Record<string, any>) {
  return new Error("Test error");
}

export function buildValidationError(message = "Validation failed") {
  const err = new Error(message);
  err.name = "ValidationError";
  return err;
}
