/**
 * Credit card - 160L consolidated
 * @internal
 */

export function buildCreditCardValidation() {
  return { configured: true, test: true };
}

export const CREDIT_CARD_VALIDATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
