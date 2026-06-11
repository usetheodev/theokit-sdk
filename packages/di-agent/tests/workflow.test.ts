import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { readWorkflowMetadata, Workflow } from "../src/decorators/workflow.js";

describe("@Workflow", () => {
  it("stores config on class", () => {
    @Workflow({ name: "pipeline" })
    class A {}
    expect(readWorkflowMetadata(A)).toEqual({ name: "pipeline" });
  });
  it("stores defaults with empty options", () => {
    @Workflow()
    class A {}
    expect(readWorkflowMetadata(A)).toEqual({});
  });
  it("returns undefined without decorator", () => {
    class Plain {}
    expect(readWorkflowMetadata(Plain)).toBeUndefined();
  });
  it("isolates between classes", () => {
    @Workflow({ name: "pipeline" })
    class A {}
    @Workflow({})
    class B {}
    expect(readWorkflowMetadata(A)).toEqual({ name: "pipeline" });
    expect(readWorkflowMetadata(B)).toEqual({});
  });
  it("preserves all options", () => {
    @Workflow({ name: "pipeline" })
    class A {}
    expect(readWorkflowMetadata(A)).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
