import { describe, expect, it } from "vitest";
import { TheoKitContainer } from "../../src/theokit-container.js";

describe("E2E: error propagation", () => {
  it("container throws on unknown agent", () => {
    const container = new TheoKitContainer({ agents: {} });
    expect(() => container.agent("ghost")).toThrow("not registered");
  });

  it("container run after dispose throws", async () => {
    const container = new TheoKitContainer({
      agents: { a: { model: "fixture/test" } },
    });
    const agent = container.agent("a");
    agent.dispose();
    await expect(container.run("a", "test")).rejects.toThrow("AgentDisposedError");
  });
});
