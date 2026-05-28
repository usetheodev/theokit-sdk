import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import { normalizeE164 } from "../src/phone.js";

describe("normalizeE164 (D391, EC-6)", () => {
  it("returns valid BR mobile number unchanged", () => {
    expect(normalizeE164("+5511999999999")).toBe("+5511999999999");
  });

  it("normalizes national BR with defaultCountry", () => {
    expect(normalizeE164("11999999999", "BR")).toBe("+5511999999999");
  });

  it("normalizes formatted US number", () => {
    expect(normalizeE164("(415) 555-0100", "US")).toBe("+14155550100");
  });

  it("EC-6: accepts US toll-free numbers", () => {
    expect(normalizeE164("+18001234567")).toBe("+18001234567");
  });

  it("throws on invalid input", () => {
    expect(() => normalizeE164("not-a-phone")).toThrow(ConfigurationError);
  });

  it("throws on empty input", () => {
    expect(() => normalizeE164("")).toThrow(ConfigurationError);
  });

  it("ConfigurationError carries code=invalid_phone_number", () => {
    try {
      normalizeE164("garbage");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect((err as ConfigurationError).code).toBe("invalid_phone_number");
      return;
    }
    throw new Error("did not throw");
  });
});
