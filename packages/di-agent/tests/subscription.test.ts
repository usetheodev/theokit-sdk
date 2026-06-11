import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { readSubscriptionMetadata, Subscription } from "../src/decorators/subscription.js";

describe("@Subscription", () => {
  it("stores metadata on property", () => {
    class A {
      @Subscription({ name: "events" }) p!: unknown;
    }
    expect(readSubscriptionMetadata(A).get("p")).toEqual({ name: "events" });
  });
  it("supports multiple properties", () => {
    class A {
      @Subscription({ name: "events" }) a!: unknown;
      @Subscription({ name: "events" }) b!: unknown;
    }
    expect(readSubscriptionMetadata(A).size).toBe(2);
  });
  it("returns empty map without decorator", () => {
    class Plain {}
    expect(readSubscriptionMetadata(Plain).size).toBe(0);
  });
  it("isolates between classes", () => {
    class A {
      @Subscription({ name: "events" }) p!: unknown;
    }
    class B {
      @Subscription({ name: "events" }) p!: unknown;
    }
    expect(readSubscriptionMetadata(A).size).toBe(1);
    expect(readSubscriptionMetadata(B).size).toBe(1);
  });
  it("preserves all options", () => {
    class A {
      @Subscription({ name: "events" }) p!: unknown;
    }
    const meta = readSubscriptionMetadata(A).get("p");
    expect(meta).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
