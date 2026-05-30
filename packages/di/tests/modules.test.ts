import { describe, expect, it } from "vitest";

import {
  Container,
  ContainerFrozenError,
  CyclicModuleImportError,
  Injectable,
  InvalidExportError,
  InvalidModuleError,
  Module,
} from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────
// T2.2 — @Module + module-loader + freeze (v1.1 EC-4, EC-8 + v1.2 EC-R2-5)
// ─────────────────────────────────────────────────────────────────────

describe("@Module() decorator + Container.registerModule()", () => {
  it("registers all providers from a module", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    @Injectable()
    class Bar {
      readonly id = 2;
    }

    @Module({ providers: [Foo, Bar] })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);

    expect(c.resolve(Foo).id).toBe(1);
    expect(c.resolve(Bar).id).toBe(2);
  });

  it("transitively registers providers from imported modules", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }

    @Module({ providers: [Foo], exports: [Foo] })
    class FooModule {}

    @Module({ imports: [FooModule] })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);

    expect(c.resolve(Foo).id).toBe(1);
  });

  it("expands bare class shorthand in providers[] to ClassProvider", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    @Module({ providers: [Foo] })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);
    expect(c.has(Foo)).toBe(true);
  });
});

describe("@Module — v1.1 EC-4 (undecorated class → InvalidModuleError)", () => {
  it("registerModule on undecorated class throws InvalidModuleError", () => {
    class PlainModule {}
    const c = new Container();
    expect(() => c.registerModule(PlainModule)).toThrowError(InvalidModuleError);
  });

  it("error message points to the missing @Module() decorator", () => {
    class NoDecorator {}
    const c = new Container();
    try {
      c.registerModule(NoDecorator);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("@Module()");
      expect((err as Error).message).toContain("NoDecorator");
    }
  });
});

describe("@Module — v1.1 EC-8 (export validation at registerModule time)", () => {
  it("throws InvalidExportError when export token is not in providers[]", () => {
    @Injectable()
    class Foo {}
    @Injectable()
    class Bar {}

    @Module({ providers: [Foo], exports: [Bar] })
    class BadModule {}

    const c = new Container();
    expect(() => c.registerModule(BadModule)).toThrowError(InvalidExportError);
  });

  it("validation happens at register-time, NOT lazily at resolve-time", () => {
    @Injectable()
    class Foo {}
    class NotAProvider {}

    @Module({ providers: [Foo], exports: [NotAProvider] })
    class BadModule {}

    const c = new Container();
    // Throws immediately, before any resolve happens.
    expect(() => c.registerModule(BadModule)).toThrowError(InvalidExportError);
  });
});

describe("@Module — cyclic imports", () => {
  it("throws CyclicModuleImportError when modules form an import cycle", () => {
    // Forward declaration trick — TypeScript needs the symbols to exist
    // before the decorator runs. We post-patch the metadata.
    @Module({})
    class ModuleA {}
    @Module({})
    class ModuleB {}

    // Patch the metadata to introduce the cycle (decorators run at class
    // creation; we need both classes defined first).
    Reflect.defineMetadata("usetheo:di:module", { imports: [ModuleB] }, ModuleA);
    Reflect.defineMetadata("usetheo:di:module", { imports: [ModuleA] }, ModuleB);

    const c = new Container();
    expect(() => c.registerModule(ModuleA)).toThrowError(CyclicModuleImportError);
  });
});

describe("@Module — v1.2 EC-R2-5 (freeze after first resolve)", () => {
  it("registerModule after first resolve throws ContainerFrozenError (default)", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    @Injectable()
    class Bar {
      readonly id = 2;
    }
    @Module({ providers: [Foo] })
    class Mod1 {}
    @Module({ providers: [Bar] })
    class Mod2 {}

    const c = new Container();
    c.registerModule(Mod1);
    c.resolve(Foo); // hasResolved = true → container frozen

    expect(() => c.registerModule(Mod2)).toThrowError(ContainerFrozenError);
  });

  it("allowDynamicRegistration:true lets registerModule succeed after resolve", () => {
    @Injectable()
    class Foo {
      readonly id = 1;
    }
    @Injectable()
    class Bar {
      readonly id = 2;
    }
    @Module({ providers: [Foo] })
    class Mod1 {}
    @Module({ providers: [Bar] })
    class Mod2 {}

    const c = new Container({ allowDynamicRegistration: true });
    c.registerModule(Mod1);
    c.resolve(Foo);

    expect(() => c.registerModule(Mod2)).not.toThrow();
    expect(c.resolve(Bar).id).toBe(2);
  });
});
