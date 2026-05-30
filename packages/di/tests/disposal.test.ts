import { describe, expect, it } from "vitest";

import {
  Container,
  ContainerDisposedError,
  type Disposable,
  Injectable,
  Scope,
} from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────
// T3.3 — Disposal lifecycle (v1.1 EC-3 + v1.2 EC-R2-4 + EC-9)
// ─────────────────────────────────────────────────────────────────────

describe("Container.dispose()", () => {
  it("calls instance.dispose() in REVERSE construction order", async () => {
    const disposalOrder: string[] = [];

    @Injectable()
    class A implements Disposable {
      dispose(): void {
        disposalOrder.push("A");
      }
    }
    @Injectable()
    class B implements Disposable {
      constructor(readonly a: A) {}
      dispose(): void {
        disposalOrder.push("B");
      }
    }

    const c = new Container({ providers: [A, B] });
    c.resolve(A); // construct A first
    c.resolve(B); // then B (which transitively constructs A, but cached)

    await c.dispose();
    // Reverse order: last-constructed disposed first.
    expect(disposalOrder).toEqual(["B", "A"]);
  });

  it("calls Symbol.asyncDispose if available (preferred over .dispose)", async () => {
    let asyncDisposeCalled = false;
    let syncDisposeCalled = false;

    @Injectable()
    class MixedDispose {
      [Symbol.asyncDispose]() {
        asyncDisposeCalled = true;
        return Promise.resolve();
      }
      dispose() {
        syncDisposeCalled = true;
      }
    }

    const c = new Container({ providers: [MixedDispose] });
    c.resolve(MixedDispose);
    await c.dispose();

    expect(asyncDisposeCalled).toBe(true);
    expect(syncDisposeCalled).toBe(false);
  });

  it("EC-9 — continues on individual failure and aggregates errors", async () => {
    @Injectable()
    class GoodA implements Disposable {
      dispose(): void {}
    }
    @Injectable()
    class BadB implements Disposable {
      dispose(): void {
        throw new Error("bad-B");
      }
    }
    @Injectable()
    class BadC implements Disposable {
      dispose(): void {
        throw new Error("bad-C");
      }
    }

    const c = new Container({ providers: [GoodA, BadB, BadC] });
    c.resolve(GoodA);
    c.resolve(BadB);
    c.resolve(BadC);

    try {
      await c.dispose();
      expect.fail("dispose should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AggregateError);
      expect((err as AggregateError).errors).toHaveLength(2);
    }
  });

  it("clears singleton cache so subsequent resolve throws ContainerDisposedError", async () => {
    @Injectable()
    class Foo {}
    const c = new Container({ providers: [Foo] });
    c.resolve(Foo);
    await c.dispose();
    expect(() => c.resolve(Foo)).toThrowError(ContainerDisposedError);
  });

  it("is idempotent — second dispose is a no-op", async () => {
    let count = 0;

    @Injectable()
    class Foo implements Disposable {
      dispose(): void {
        count += 1;
      }
    }
    const c = new Container({ providers: [Foo] });
    c.resolve(Foo);
    await c.dispose();
    await c.dispose();
    expect(count).toBe(1);
  });

  it("Symbol.asyncDispose enables `await using` syntax", async () => {
    let disposed = false;

    @Injectable()
    class Tracker implements Disposable {
      dispose(): void {
        disposed = true;
      }
    }

    {
      await using c = new Container({ providers: [Tracker] });
      c.resolve(Tracker);
    } // scope exits → dispose() called

    expect(disposed).toBe(true);
  });
});

describe("runInRequest — v1.1 EC-3 (disposal even on callback throw)", () => {
  it("disposes REQUEST-scoped instances when callback succeeds", async () => {
    let disposed = false;

    @Injectable()
    class Tracker implements Disposable {
      dispose(): void {
        disposed = true;
      }
    }
    const c = new Container();
    c.register({ provide: Tracker, useClass: Tracker, scope: Scope.REQUEST });

    await c.runInRequest(async () => {
      c.resolve(Tracker);
    });

    expect(disposed).toBe(true);
  });

  it("disposes REQUEST-scoped instances EVEN IF the callback throws", async () => {
    let disposed = false;

    @Injectable()
    class Tracker implements Disposable {
      dispose(): void {
        disposed = true;
      }
    }
    const c = new Container();
    c.register({ provide: Tracker, useClass: Tracker, scope: Scope.REQUEST });

    await expect(
      c.runInRequest(async () => {
        c.resolve(Tracker);
        throw new Error("handler-boom");
      }),
    ).rejects.toThrow("handler-boom");

    // Must still dispose despite the throw.
    expect(disposed).toBe(true);
  });
});
