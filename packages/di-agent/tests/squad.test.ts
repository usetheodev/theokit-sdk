import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { readSquadMetadata, Squad, type SquadMetadata } from "../src/decorators/squad.js";

describe("@Squad", () => {
  const spec: SquadMetadata = {
    agents: ["researcher", "writer"],
    process: "sequential",
  };

  it("stores spec on decorated property", () => {
    class MyTeam {
      @Squad(spec)
      pipeline!: unknown;
    }
    expect(readSquadMetadata(MyTeam).get("pipeline")).toEqual(spec);
  });

  it("defaults process to undefined (runtime default = sequential)", () => {
    class T {
      @Squad({ agents: ["a", "b"] })
      p!: unknown;
    }
    expect(readSquadMetadata(T).get("p")?.process).toBeUndefined();
  });

  it("supports multiple squad properties", () => {
    class T {
      @Squad({ agents: ["a"] })
      one!: unknown;
      @Squad({ agents: ["b", "c"] })
      two!: unknown;
    }
    const meta = readSquadMetadata(T);
    expect(meta.size).toBe(2);
    expect(meta.get("two")?.agents).toEqual(["b", "c"]);
  });

  it("returns empty map for undecorated class", () => {
    class Plain {}
    expect(readSquadMetadata(Plain).size).toBe(0);
  });
});
