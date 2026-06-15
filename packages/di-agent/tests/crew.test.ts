import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { Crew, type CrewMetadata, readCrewMetadata } from "../src/decorators/crew.js";

describe("@Crew", () => {
  const spec: CrewMetadata = {
    agents: ["researcher", "writer"],
    process: "sequential",
  };

  it("stores spec on decorated property", () => {
    class MyTeam {
      @Crew(spec)
      pipeline!: unknown;
    }
    expect(readCrewMetadata(MyTeam).get("pipeline")).toEqual(spec);
  });

  it("defaults process to undefined (runtime default = sequential)", () => {
    class T {
      @Crew({ agents: ["a", "b"] })
      p!: unknown;
    }
    expect(readCrewMetadata(T).get("p")?.process).toBeUndefined();
  });

  it("supports multiple crew properties", () => {
    class T {
      @Crew({ agents: ["a"] })
      one!: unknown;
      @Crew({ agents: ["b", "c"] })
      two!: unknown;
    }
    const meta = readCrewMetadata(T);
    expect(meta.size).toBe(2);
    expect(meta.get("two")?.agents).toEqual(["b", "c"]);
  });

  it("returns empty map for undecorated class", () => {
    class Plain {}
    expect(readCrewMetadata(Plain).size).toBe(0);
  });
});
