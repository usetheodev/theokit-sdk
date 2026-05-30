import { describe, expect, it } from "vitest";

import {
  AsyncProviderInSyncResolveError,
  Container,
  Inject,
  Injectable,
  Scope,
} from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────
// T3.1 — resolveAsync + async detection
// ─────────────────────────────────────────────────────────────────────

describe("Container.resolveAsync", () => {
  it("awaits and returns the value from an async factory", async () => {
    const c = new Container();
    c.register({
      provide: "X",
      useFactory: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 42;
      },
    });
    expect(await c.resolveAsync<number>("X")).toBe(42);
  });

  it("transitively awaits a chain of async deps", async () => {
    const c = new Container();
    c.register({
      provide: "A",
      useFactory: async () => "a",
    });
    c.register({
      provide: "B",
      useFactory: async (a: string) => `b-of-${a}`,
      inject: ["A"],
    });
    expect(await c.resolveAsync<string>("B")).toBe("b-of-a");
  });

  it("propagates rejection from async factory", async () => {
    const c = new Container();
    c.register({
      provide: "X",
      useFactory: async () => {
        throw new Error("nope");
      },
    });
    await expect(c.resolveAsync<unknown>("X")).rejects.toThrow("nope");
  });

  it("resolveAsync of sync provider still returns a Promise", async () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    const c = new Container({ providers: [Foo] });
    const promise = c.resolveAsync(Foo);
    expect(promise).toBeInstanceOf(Promise);
    expect((await promise).id).toBe(1);
  });
});

describe("Container.resolve — async chain defensive check", () => {
  it("sync resolve on async factory throws AsyncProviderInSyncResolveError", () => {
    const c = new Container();
    c.register({ provide: "X", useFactory: async () => 42 });
    expect(() => c.resolve<number>("X")).toThrowError(AsyncProviderInSyncResolveError);
  });

  it("sync resolve on class whose dep is async also throws", () => {
    @Injectable()
    class WithAsyncDep {
      // biome-ignore lint/correctness/noUnusedVariables: dep field is here only to trigger DI
      constructor(readonly num: number) {}
    }
    const c = new Container();
    c.register({ provide: "N", useFactory: async () => 1 });
    c.register({
      provide: WithAsyncDep,
      useFactory: (n: number) => new WithAsyncDep(n),
      inject: ["N"],
    });
    expect(() => c.resolve(WithAsyncDep)).toThrowError(AsyncProviderInSyncResolveError);
  });
});

describe("Container.resolveAsync — EC-R3-1 single-flight factory invariant", () => {
  it("class with async dep invokes factory exactly ONCE per resolve (no sync-discard double-call)", async () => {
    let factoryCalls = 0;
    @Injectable()
    class WithAsyncDep {
      constructor(@Inject("N") readonly num: number) {}
    }
    const c = new Container();
    c.register({
      provide: "N",
      useFactory: async () => {
        factoryCalls += 1;
        await new Promise((r) => setTimeout(r, 1));
        return factoryCalls;
      },
    });
    c.register(WithAsyncDep);
    const instance = await c.resolveAsync(WithAsyncDep);
    expect(factoryCalls).toBe(1);
    expect(instance.num).toBe(1);
  });

  it("REQUEST-scoped async dep invoked ONCE per request even via class constructor", async () => {
    let factoryCalls = 0;
    @Injectable({ scope: Scope.REQUEST })
    class Service {
      constructor(@Inject("ID") readonly id: number) {}
    }
    const c = new Container();
    c.register({
      provide: "ID",
      useFactory: async () => {
        factoryCalls += 1;
        await new Promise((r) => setTimeout(r, 1));
        return factoryCalls;
      },
      scope: Scope.REQUEST,
    });
    c.register(Service);

    const a = await c.runInRequest(async () => c.resolveAsync(Service));
    const b = await c.runInRequest(async () => c.resolveAsync(Service));
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(factoryCalls).toBe(2);
  });
});

describe("Container.runInRequest — REQUEST cache async + sync interplay", () => {
  it("cached async value can be resolved sync on second resolve (same request)", async () => {
    const c = new Container();
    c.register({
      provide: "X",
      useFactory: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 42;
      },
      scope: Scope.REQUEST,
    });

    const result = await c.runInRequest(async () => {
      const first = await c.resolveAsync<number>("X");
      // Second resolve hits cached value (not Promise) — sync works now.
      const second = c.resolve<number>("X");
      return { first, second };
    });
    expect(result.first).toBe(42);
    expect(result.second).toBe(42);
  });
});
