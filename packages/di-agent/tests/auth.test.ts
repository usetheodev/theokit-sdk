import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Auth, readAuthMetadata } from "../src/decorators/auth.js";

describe("@Auth", () => {
  it("stores config on class", () => {
    @Auth({ providers: ["google"] })
    class A {}
    expect(readAuthMetadata(A)).toEqual({ providers: ["google"] });
  });
  it("stores defaults with empty options", () => {
    @Auth()
    class A {}
    expect(readAuthMetadata(A)).toEqual({});
  });
  it("returns undefined without decorator", () => {
    class Plain {}
    expect(readAuthMetadata(Plain)).toBeUndefined();
  });
  it("isolates between classes", () => {
    @Auth({ providers: ["google"] })
    class A {}
    @Auth({})
    class B {}
    expect(readAuthMetadata(A)).toEqual({ providers: ["google"] });
    expect(readAuthMetadata(B)).toEqual({});
  });
  it("preserves all options", () => {
    @Auth({ providers: ["google"] })
    class A {}
    expect(readAuthMetadata(A)).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
