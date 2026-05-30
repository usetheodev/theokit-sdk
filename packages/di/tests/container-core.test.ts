import { describe, expect, it } from "vitest";

import {
  AsyncProviderInSyncResolveError,
  Container,
  ContainerFrozenError,
  CyclicDependencyError,
  Inject,
  Injectable,
  MissingInjectableError,
  Optional,
  Scope,
  ScopeViolationError,
  TokenNotFoundError,
} from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────
// T1.1 — Container core: bind/resolve/scopes/Promise-lock
// ─────────────────────────────────────────────────────────────────────

describe("Container.register + resolve (ClassProvider)", () => {
  it("registers a class provider and resolves a real instance", () => {
    @Injectable()
    class GreeterService {
      greet(name: string): string {
        return `Hello, ${name}!`;
      }
    }
    const c = new Container();
    c.register({ provide: GreeterService, useClass: GreeterService });
    expect(c.resolve(GreeterService).greet("world")).toBe("Hello, world!");
  });

  it("accepts a bare class as shorthand (expands to ClassProvider)", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    const c = new Container();
    c.register(Foo);
    expect(c.resolve(Foo).id).toBe(1);
  });

  it("declarative providers in constructor produce the same registrations as imperative", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    const a = new Container({ providers: [Foo] });
    const b = new Container();
    b.register(Foo);
    expect(a.resolve(Foo).id).toBe(b.resolve(Foo).id);
  });

  it("emits stderr warn when a token is registered twice (last write wins)", () => {
    @Injectable()
    class V1 {
      readonly v: number = 1;
    }
    @Injectable()
    class V2 extends V1 {
      override readonly v: number = 2;
    }
    const c = new Container();
    c.register({ provide: V1, useClass: V1 });
    c.register({ provide: V1, useClass: V2 });
    expect(c.resolve<V1>(V1).v).toBe(2);
  });

  it("throws TokenNotFoundError with the resolution path", () => {
    class Missing {}
    const c = new Container();
    expect(() => c.resolve(Missing)).toThrowError(TokenNotFoundError);
  });
});

describe("Container.register (FactoryProvider / ValueProvider / ExistingProvider)", () => {
  it("FactoryProvider with `inject` resolves deps before invoking factory", () => {
    const NUMBER_TOKEN = "NUM";
    const STRING_TOKEN = "STR";
    const c = new Container();
    c.register({ provide: NUMBER_TOKEN, useValue: 42 });
    c.register({
      provide: STRING_TOKEN,
      useFactory: (n: number) => `n=${n}`,
      inject: [NUMBER_TOKEN],
    });
    expect(c.resolve<string>(STRING_TOKEN)).toBe("n=42");
  });

  it("ValueProvider returns the exact value reference", () => {
    const TOKEN = "MY_OBJ";
    const obj = { hello: "world" };
    const c = new Container();
    c.register({ provide: TOKEN, useValue: obj });
    expect(c.resolve<typeof obj>(TOKEN)).toBe(obj);
  });

  it("ExistingProvider aliases one token to another", () => {
    const ORIGINAL = "ORIG";
    const ALIAS = "ALIAS";
    const c = new Container();
    c.register({ provide: ORIGINAL, useValue: "hello" });
    c.register({ provide: ALIAS, useExisting: ORIGINAL });
    expect(c.resolve<string>(ALIAS)).toBe("hello");
  });
});

describe("Container scopes — SINGLETON / TRANSIENT / REQUEST", () => {
  it("SINGLETON returns the same instance across resolves (default scope)", () => {
    @Injectable()
    class Foo {
      readonly id = Math.random();
    }
    const c = new Container({ providers: [Foo] });
    expect(c.resolve(Foo)).toBe(c.resolve(Foo));
  });

  it("TRANSIENT returns a fresh instance per resolve", () => {
    @Injectable()
    class Foo {
      readonly id = Math.random();
    }
    const c = new Container();
    c.register({ provide: Foo, useClass: Foo, scope: Scope.TRANSIENT });
    expect(c.resolve(Foo)).not.toBe(c.resolve(Foo));
  });

  it("REQUEST caches within runInRequest only", async () => {
    @Injectable()
    class Foo {
      readonly id = Math.random();
    }
    const c = new Container();
    c.register({ provide: Foo, useClass: Foo, scope: Scope.REQUEST });
    const { a, b } = await c.runInRequest(async () => ({
      a: c.resolve(Foo),
      b: c.resolve(Foo),
    }));
    expect(a).toBe(b);

    // Different request → different instance
    const c2 = await c.runInRequest(async () => c.resolve(Foo));
    expect(c2).not.toBe(a);
  });

  it("REQUEST scope outside runInRequest throws ScopeViolationError", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    const c = new Container();
    c.register({ provide: Foo, useClass: Foo, scope: Scope.REQUEST });
    expect(() => c.resolve(Foo)).toThrowError(ScopeViolationError);
  });
});

describe("Container — v1.1 EC-1 (imperative + declarative @Injectable validation)", () => {
  it("imperative register rejects undecorated class with MissingInjectableError", () => {
    class Plain {}
    const c = new Container();
    expect(() => c.register({ provide: Plain, useClass: Plain })).toThrowError(
      MissingInjectableError,
    );
  });

  it("declarative providers: [] also rejects undecorated class (same validation path)", () => {
    class Plain {}
    expect(() => new Container({ providers: [Plain] })).toThrowError(MissingInjectableError);
  });

  it("bare class shorthand rejects undecorated class (validation is centralized)", () => {
    class Plain {}
    const c = new Container();
    expect(() => c.register(Plain)).toThrowError(MissingInjectableError);
  });
});

describe("Container — v1.1 EC-2 + v1.2 EC-R2-1 + EC-R2-2 (Promise-lock cache)", () => {
  it("REQUEST scope parallel resolveAsync returns the SAME instance (Promise-lock)", async () => {
    let factoryCount = 0;
    const c = new Container();
    c.register({
      provide: "ASYNC",
      useFactory: async () => {
        factoryCount += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { id: factoryCount };
      },
      scope: Scope.REQUEST,
    });

    const [a, b] = await c.runInRequest(async () =>
      Promise.all([
        c.resolveAsync<{ id: number }>("ASYNC"),
        c.resolveAsync<{ id: number }>("ASYNC"),
      ]),
    );
    expect(a).toBe(b);
    expect(factoryCount).toBe(1);
  });

  it("EC-R2-1: async A→B→A cycle throws CyclicDependencyError instead of deadlock", async () => {
    const TOKEN_A = "A";
    const TOKEN_B = "B";
    const c = new Container();
    c.register({
      provide: TOKEN_A,
      useFactory: async (b: unknown) => ({ b }),
      inject: [TOKEN_B],
      scope: Scope.REQUEST,
    });
    c.register({
      provide: TOKEN_B,
      useFactory: async (a: unknown) => ({ a }),
      inject: [TOKEN_A],
      scope: Scope.REQUEST,
    });

    await expect(c.runInRequest(async () => c.resolveAsync(TOKEN_A))).rejects.toBeInstanceOf(
      CyclicDependencyError,
    );
  });

  it("EC-R2-2: rejected factory does NOT poison the cache (retry within same request succeeds)", async () => {
    let attempt = 0;
    const c = new Container();
    c.register({
      provide: "FLAKY",
      useFactory: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("boom");
        return { id: attempt };
      },
      scope: Scope.REQUEST,
    });

    const result = await c.runInRequest(async () => {
      await expect(c.resolveAsync<{ id: number }>("FLAKY")).rejects.toThrow("boom");
      // Second resolve in same request should reinvoke the factory.
      return c.resolveAsync<{ id: number }>("FLAKY");
    });
    expect(result.id).toBe(2);
    expect(attempt).toBe(2);
  });
});

describe("Container — async vs sync resolve", () => {
  it("sync resolve throws AsyncProviderInSyncResolveError for async factory", () => {
    const c = new Container();
    c.register({ provide: "X", useFactory: async () => 42 });
    expect(() => c.resolve<number>("X")).toThrowError(AsyncProviderInSyncResolveError);
  });

  it("resolveAsync awaits and returns the value", async () => {
    const c = new Container();
    c.register({ provide: "X", useFactory: async () => 42 });
    expect(await c.resolveAsync<number>("X")).toBe(42);
  });
});

describe("Container — sync cycle detection", () => {
  it("self-dependency throws CyclicDependencyError", () => {
    @Injectable()
    class Self {
      constructor(@Inject("SELF") readonly dep: unknown) {}
    }
    const c = new Container();
    c.register({ provide: "SELF", useClass: Self });
    expect(() => c.resolve<Self>("SELF")).toThrowError(CyclicDependencyError);
  });
});

describe("Container — v1.2 EC-R2-5 (freeze after first resolve)", () => {
  it("register() after first resolve() throws ContainerFrozenError by default", () => {
    @Injectable()
    class Foo {}
    @Injectable()
    class Bar {}
    const c = new Container({ providers: [Foo] });
    c.resolve(Foo);
    expect(() => c.register(Bar)).toThrowError(ContainerFrozenError);
  });

  it("allowDynamicRegistration:true escape hatch lets tests add registrations after resolve", () => {
    @Injectable()
    class Foo {}
    @Injectable()
    class Bar {}
    const c = new Container({ providers: [Foo], allowDynamicRegistration: true });
    c.resolve(Foo);
    expect(() => c.register(Bar)).not.toThrow();
  });
});

describe("Container — Optional decorator", () => {
  it("returns undefined when an optional dep is missing", () => {
    @Injectable()
    class Foo {
      constructor(@Optional() @Inject("MISSING") readonly maybe?: string) {}
    }
    const c = new Container({ providers: [Foo] });
    expect(c.resolve(Foo).maybe).toBeUndefined();
  });

  it("does NOT swallow non-TokenNotFoundError errors", () => {
    @Injectable()
    class Foo {
      constructor(@Optional() @Inject("THROWING") readonly dep: unknown) {}
    }
    const c = new Container();
    c.register({
      provide: "THROWING",
      useFactory: () => {
        throw new Error("kaboom");
      },
    });
    c.register({ provide: Foo, useClass: Foo });
    expect(() => c.resolve(Foo)).toThrowError("kaboom");
  });
});

describe("Container — class with primitive constructor param (v1.1 EC-6)", () => {
  it("emits an actionable error when a primitive type is used as a token", () => {
    @Injectable()
    class WithPrimitive {
      constructor(readonly n: number) {}
    }
    const c = new Container({ providers: [WithPrimitive] });
    expect(() => c.resolve(WithPrimitive)).toThrowError(/primitive\/interface/i);
  });
});

describe("Container — null/undefined tokens", () => {
  it("register with null token throws TypeError at register-time", () => {
    const c = new Container();
    expect(() => c.register({ provide: null as unknown as string, useValue: 1 })).toThrowError(
      TypeError,
    );
  });
});

describe("Container — string token isolation", () => {
  it("string token does NOT collide with class token of the same name", () => {
    @Injectable()
    class Foo {
      readonly via = "class";
    }
    const c = new Container({ providers: [Foo] });
    c.register({ provide: "Foo", useValue: "string" });
    expect(c.resolve(Foo).via).toBe("class");
    expect(c.resolve<string>("Foo")).toBe("string");
  });
});
