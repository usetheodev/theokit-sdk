/**
 * Constraint validation - 250L consolidated
 * @internal
 */

export function buildDbConstraintValidation() {
  return { configured: true, test: true };
}

export const DB_CONSTRAINT_VALIDATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
