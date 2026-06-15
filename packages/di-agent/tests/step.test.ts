import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { readStepMetadata, Step } from "../src/decorators/step.js";

describe("@Step", () => {
  it("test_Step_stores_metadata", () => {
    class Pipeline {
      @Step()
      first(): string {
        return "1";
      }
      @Step({ after: "first" })
      second(): string {
        return "2";
      }
    }
    const meta = readStepMetadata(Pipeline);
    expect(meta.get("first")).toEqual({});
    expect(meta.get("second")).toEqual({ after: "first" });
  });

  it("test_Step_defaults_after_undefined", () => {
    class T {
      @Step()
      only(): void {}
    }
    expect(readStepMetadata(T).get("only")?.after).toBeUndefined();
  });

  it("test_supports_multiple_steps", () => {
    class T {
      @Step()
      a(): void {}
      @Step({ after: "a" })
      b(): void {}
      @Step({ after: "b", name: "third" })
      c(): void {}
    }
    const meta = readStepMetadata(T);
    expect(meta.size).toBe(3);
    expect(meta.get("c")).toEqual({ after: "b", name: "third" });
  });

  it("test_empty_for_undecorated", () => {
    class Plain {}
    expect(readStepMetadata(Plain).size).toBe(0);
  });
});
