/**
 * E.164 phone normalization (D391, EC-6).
 *
 * Wraps `libphonenumber-js` (full — accepts mobile + toll-free; the
 * `/mobile` sub-bundle was inadequate because it rejects toll-free
 * US 1-800 numbers).
 *
 * @internal
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";

import { ConfigurationError } from "./errors.js";

/**
 * Normalize a free-form phone number to canonical E.164 (`+5511999999999`).
 *
 * Accepts:
 * - International with `+`: `"+5511999999999"` → unchanged.
 * - National without `+` when `defaultCountry` is provided: `("11999999999", "BR")` → `"+5511999999999"`.
 * - Toll-free US (EC-6): `"+18001234567"` → unchanged.
 *
 * Throws `ConfigurationError({ code: "invalid_phone_number" })` on any
 * input that cannot be parsed to a valid number.
 */
export function normalizeE164(input: string, defaultCountry?: string): string {
  if (input.length === 0) {
    throw new ConfigurationError({
      code: "invalid_phone_number",
      message: "gateway-sms: phone number is empty",
      detail: "<empty>",
    });
  }
  const parsed = parsePhoneNumberFromString(
    input,
    defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1],
  );
  if (parsed === undefined || !parsed.isValid()) {
    throw new ConfigurationError({
      code: "invalid_phone_number",
      message: `gateway-sms: invalid phone number ${JSON.stringify(input)}`,
      detail: input,
    });
  }
  return parsed.format("E.164");
}
