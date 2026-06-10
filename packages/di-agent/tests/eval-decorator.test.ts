import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { EvalDecorator, readEvalDecoratorMetadata } from "../src/decorators/eval-decorator.js";

describe("@EvalDecorator", () => {
  it("stores config on class", () => {
    @EvalDecorator({ name: "quality" })
    class A {}
    expect(readEvalDecoratorMetadata(A)).toEqual({ name: "quality" });
  });
  it("stores defaults with empty options", () => {
    @EvalDecorator()
    class A {}
    expect(readEvalDecoratorMetadata(A)).toEqual({});
  });
  it("returns undefined without decorator", () => {
    class Plain {}
    expect(readEvalDecoratorMetadata(Plain)).toBeUndefined();
  });
  it("isolates between classes", () => {
    @EvalDecorator({ name: "quality" })
    class A {}
    @EvalDecorator({})
    class B {}
    expect(readEvalDecoratorMetadata(A)).toEqual({ name: "quality" });
    expect(readEvalDecoratorMetadata(B)).toEqual({});
  });
  it("preserves all options", () => {
    @EvalDecorator({ name: "quality" })
    class A {}
    expect(readEvalDecoratorMetadata(A)).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
