import { describe, expect, it } from "vitest";

import { Container, Inject, Injectable, Scope } from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────
// T3.2 — Cyclic detection + container.analyze() debug
// ─────────────────────────────────────────────────────────────────────

describe("Container.analyze() — debug dependency graph", () => {
  it("returns all registered nodes with scope info", () => {
    @Injectable()
    class Foo {}
    @Injectable()
    class Bar {}
    const c = new Container({
      providers: [Foo, { provide: Bar, useClass: Bar, scope: Scope.TRANSIENT }],
    });

    const graph = c.analyze();
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.find((n) => n.token === Foo)?.scope).toBe(Scope.SINGLETON);
    expect(graph.nodes.find((n) => n.token === Bar)?.scope).toBe(Scope.TRANSIENT);
  });

  it("returns edges from class providers via constructor metadata", () => {
    @Injectable()
    class Logger {}
    @Injectable()
    class Service {
      constructor(readonly logger: Logger) {}
    }
    const c = new Container({ providers: [Logger, Service] });
    const graph = c.analyze();
    expect(graph.edges).toContainEqual({ from: Service, to: Logger });
  });

  it("returns empty cycles when there are none", () => {
    @Injectable()
    class Foo {}
    @Injectable()
    class Bar {
      constructor(readonly foo: Foo) {}
    }
    const c = new Container({ providers: [Foo, Bar] });
    expect(c.analyze().cycles).toHaveLength(0);
  });

  it("detects a cycle in unused providers (lazy resolve never triggers)", () => {
    @Injectable()
    class A {
      // biome-ignore lint/correctness/noUnusedVariables: dep field triggers DI
      constructor(@Inject("B") readonly b: unknown) {}
    }
    @Injectable()
    class B {
      // biome-ignore lint/correctness/noUnusedVariables: dep field triggers DI
      constructor(@Inject("A") readonly a: unknown) {}
    }
    const c = new Container();
    c.register({ provide: "A", useClass: A });
    c.register({ provide: "B", useClass: B });

    const cycles = c.analyze().cycles;
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  it("EC-11 — handles a graph with 50+ nodes and multiple cycles without stack overflow", () => {
    const c = new Container();
    // Build a linear chain of 50 providers via @Inject string tokens.
    for (let i = 0; i < 50; i += 1) {
      const token = `N${i}`;
      const nextToken = `N${(i + 1) % 50}`;
      // Each provider depends on the next (circular at boundary).
      const factory = (next: unknown): { id: number; next: unknown } => ({ id: i, next });
      c.register({
        provide: token,
        useFactory: factory,
        inject: [nextToken],
      });
    }
    // analyze() must not stack-overflow even with a cycle in the graph.
    const result = c.analyze();
    expect(result.nodes).toHaveLength(50);
    expect(result.cycles.length).toBeGreaterThan(0);
  });
});
