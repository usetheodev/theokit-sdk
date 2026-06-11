import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Primary } from "../src/decorators/primary.js";
import { Qualifier } from "../src/decorators/qualifier.js";
import { METADATA_KEYS } from "../src/internal/metadata.js";

describe("@Qualifier decorator", () => {
  it("stores qualifier name on parameter", () => {
    class Service {
      constructor(@Qualifier("admin") public svc: unknown) {}
    }
    const map: Map<number, string> = Reflect.getMetadata(METADATA_KEYS.QUALIFIER_NAMES, Service);
    expect(map).toBeDefined();
    expect(map.get(0)).toBe("admin");
  });

  it("stores multiple qualifiers on different params", () => {
    class Service {
      constructor(
        @Qualifier("admin") public a: unknown,
        @Qualifier("readonly") public b: unknown,
      ) {}
    }
    const map: Map<number, string> = Reflect.getMetadata(METADATA_KEYS.QUALIFIER_NAMES, Service);
    expect(map.get(0)).toBe("admin");
    expect(map.get(1)).toBe("readonly");
  });

  it("returns undefined when no qualifier set", () => {
    class Service {
      constructor(public a: unknown) {}
    }
    const map = Reflect.getMetadata(METADATA_KEYS.QUALIFIER_NAMES, Service);
    expect(map).toBeUndefined();
  });
});

describe("@Primary decorator", () => {
  it("marks class as primary", () => {
    @Primary
    class StripePayments {}
    expect(Reflect.getMetadata(METADATA_KEYS.PRIMARY, StripePayments)).toBe(true);
  });

  it("non-primary class has no PRIMARY metadata", () => {
    class PayPalPayments {}
    expect(Reflect.getMetadata(METADATA_KEYS.PRIMARY, PayPalPayments)).toBeUndefined();
  });
});
