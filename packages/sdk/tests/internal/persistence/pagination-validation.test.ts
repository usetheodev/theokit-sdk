/**
 * M2 #63 (adversarial-review gap) — `paginate` silently coerced invalid cursors
 * (`NaN` offset → the FULL list; negative → empty), instead of rejecting them.
 * Invalid pagination input must fail-fast with a typed error (error-handling.md).
 */
import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../../../src/errors.js";
import { paginate } from "../../../src/internal/persistence/pagination.js";

const items = [0, 1, 2, 3, 4];

describe("paginate — input validation (#63)", () => {
  it("applies a valid window", () => {
    expect(paginate(items, { offset: 1, limit: 2 })).toEqual([1, 2]);
    expect(paginate(items, { offset: 3 })).toEqual([3, 4]);
    expect(paginate(items, undefined)).toEqual(items);
    expect(paginate(items, { limit: 0 })).toEqual([]);
  });

  it("rejects a NaN offset (was silently returning the full list)", () => {
    expect(() => paginate(items, { offset: Number.NaN })).toThrow(ConfigurationError);
  });

  it("rejects a negative offset / limit", () => {
    expect(() => paginate(items, { offset: -1 })).toThrow(ConfigurationError);
    expect(() => paginate(items, { limit: -5 })).toThrow(ConfigurationError);
  });

  it("rejects a non-integer offset / limit", () => {
    expect(() => paginate(items, { offset: 1.5 })).toThrow(ConfigurationError);
    expect(() => paginate(items, { limit: 2.7 })).toThrow(ConfigurationError);
  });

  it("rejects a non-finite limit", () => {
    expect(() => paginate(items, { limit: Number.POSITIVE_INFINITY })).toThrow(ConfigurationError);
  });
});
