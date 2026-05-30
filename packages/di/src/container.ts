/**
 * Container — the DI runtime. Implements:
 *   - 3 scopes (SINGLETON / TRANSIENT / REQUEST via AsyncLocalStorage)
 *   - 4 provider types (useClass / useFactory / useValue / useExisting)
 *   - Cycle detection at resolve-time (path tracking)
 *   - Promise-lock REQUEST cache (v1.1 EC-2) with cycle-first ordering
 *     (v1.2 EC-R2-1) and reject cleanup (v1.2 EC-R2-2)
 *   - Disposal lifecycle (T3.3) + freeze on first resolve (v1.2 EC-R2-5)
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  AsyncProviderInSyncResolveError,
  ContainerDisposedError,
  ContainerFrozenError,
  CyclicDependencyError,
  describeToken,
  MissingInjectableError,
  ReflectMetadataMissingError,
  ScopeViolationError,
  TokenNotFoundError,
} from "./errors.js";
import { findCycles, type GraphEdge, type GraphNode } from "./internal/graph.js";
import {
  hasReflectMetadata,
  isInjectable,
  isPrimitiveTypeMarker,
  readInjectableMetadata,
  readInjectTokens,
  readOptionalFlags,
  readParamTypes,
} from "./internal/metadata.js";
import { loadModule } from "./internal/module-loader.js";
import type {
  ClassConstructor,
  ClassProvider,
  ContainerOptions,
  ExistingProvider,
  FactoryProvider,
  Provider,
  ResolutionContext,
  Token,
  ValueProvider,
} from "./types.js";
import { Scope } from "./types.js";

interface RequestStore {
  /**
   * Per-request cache. Stores either a resolved value OR a pending Promise
   * during materialization (v1.1 EC-2). On Promise rejection, the entry is
   * deleted (v1.2 EC-R2-2).
   */
  readonly cache: Map<Token, unknown>;
  /** Instances created during this request — disposed when request ends. */
  readonly instances: Disposable[];
}

interface Disposable {
  dispose(): void | Promise<void>;
}

interface Registration<T = unknown> {
  readonly token: Token<T>;
  readonly scope: Scope;
  readonly factory: (ctx: ResolutionContext) => T | Promise<T>;
  /**
   * For class providers — the target class. Used by `analyze()` to derive
   * edges via `design:paramtypes` metadata.
   */
  readonly classTarget?: ClassConstructor<T>;
  /**
   * For factory providers — the explicit inject list. Used by `analyze()`
   * to derive edges.
   */
  readonly injectTokens?: ReadonlyArray<Token>;
  /**
   * For existing providers — the aliased token. Used by `analyze()` to
   * derive edges.
   */
  readonly aliasTarget?: Token;
}

/**
 * Lightweight DI container. See `README.md` for usage examples.
 */
export class Container {
  private readonly registrations = new Map<Token, Registration>();
  private readonly singletonCache = new Map<Token, unknown>();
  private readonly singletonInstances: Disposable[] = [];
  private readonly requestStorage = new AsyncLocalStorage<RequestStore>();
  private readonly options: Required<ContainerOptions>;
  private hasResolved = false;
  private disposed = false;

  constructor(options: ContainerOptions = {}) {
    this.options = {
      providers: options.providers ?? [],
      allowDynamicRegistration: options.allowDynamicRegistration ?? false,
    };
    // Proactive probe — if reflect-metadata is missing, surface early
    // rather than at first resolve. ReflectMetadataMissingError is thrown
    // only at the first class-resolve attempt; we tolerate non-class
    // setups (only value/factory providers don't need it).
    // (No throw here — see resolveClass.)
    for (const provider of this.options.providers) {
      this.register(provider);
    }
  }

  /**
   * Register a provider. Accepts:
   *   - A full Provider (useClass / useFactory / useValue / useExisting)
   *   - A bare class (shorthand expands to ClassProvider { provide: X, useClass: X })
   *
   * Per v1.1 EC-1, ClassProvider validation runs via `validateClassProvider()`
   * regardless of which API path was used.
   */
  register<T>(providerOrClass: Provider<T> | ClassConstructor<T>): void {
    this.assertNotDisposed();
    this.assertNotFrozen(this.tokenOf(providerOrClass));

    const provider = this.normalizeShorthand(providerOrClass);
    this.validateProvider(provider);

    const registration = this.normalizeProvider(provider);

    if (this.registrations.has(registration.token)) {
      // NestJS behavior: last write wins. Single stderr warn.
      process.stderr.write(
        `[@usetheo/di] Warning: provider for token ${describeToken(registration.token)} replaced.\n`,
      );
    }
    this.registrations.set(registration.token, registration);
  }

  /**
   * Load a `@Module()`-decorated class plus all transitively imported
   * modules. Walks imports BFS, registers every provider, validates
   * exports.
   *
   * Per v1.1 EC-4: undecorated class throws `InvalidModuleError`.
   * Per v1.2 EC-R2-5: respects the freeze-after-first-resolve guarantee
   *   (each child `register()` checks `assertNotFrozen`).
   */
  registerModule(moduleClass: ClassConstructor): void {
    this.assertNotDisposed();
    loadModule(moduleClass, this);
  }

  /**
   * True if the container has a registration for `token`.
   */
  has(token: Token): boolean {
    return this.registrations.has(token);
  }

  /**
   * Synchronously resolve a token. Throws `AsyncProviderInSyncResolveError`
   * if the resolution chain contains an async provider.
   */
  resolve<T>(token: Token<T>): T {
    this.assertNotDisposed();
    this.hasResolved = true;
    const ctx = this.createContext([]);
    return this.resolveInContext(token, ctx) as T;
  }

  /**
   * Asynchronously resolve a token. Always returns a Promise even for sync
   * providers (for API uniformity).
   */
  async resolveAsync<T>(token: Token<T>): Promise<T> {
    this.assertNotDisposed();
    this.hasResolved = true;
    const ctx = this.createContextAsync([]);
    return (await this.resolveAsyncInContext(token, ctx)) as T;
  }

  /**
   * Run `callback` inside a fresh REQUEST scope. All REQUEST-scoped
   * providers resolved within `callback` (or any async continuation) share
   * a single per-request cache.
   *
   * v1.1 EC-3: try/finally guarantees REQUEST-scoped instances are disposed
   * even if the callback throws.
   */
  async runInRequest<R>(callback: () => R | Promise<R>): Promise<R> {
    this.assertNotDisposed();
    const store: RequestStore = {
      cache: new Map(),
      instances: [],
    };
    try {
      return await this.requestStorage.run(store, async () => callback());
    } finally {
      await this.disposeInstances(store.instances);
    }
  }

  /**
   * Debug helper — returns a snapshot of the dependency graph.
   *
   * Per ADR D7: detects cycles in unused providers too (resolve-time
   * detection only fires for resolves that actually traverse the cycle).
   * Use this proactively in tests / dev mode to surface latent cycles.
   */
  analyze(): {
    nodes: GraphNode[];
    edges: GraphEdge[];
    cycles: ReadonlyArray<ReadonlyArray<Token>>;
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const [token, registration] of this.registrations.entries()) {
      nodes.push({
        token,
        scope: registration.scope,
        isAsync: false, // resolved at resolve-time; v1 leaves this as best-effort.
      });
      // Edges are inferred via constructor metadata for class providers and
      // explicit inject lists for factory providers. ValueProvider has none.
      const deps = this.getDirectDependencies(token);
      for (const dep of deps) {
        edges.push({ from: token, to: dep });
      }
    }
    const cycles = findCycles({ nodes, edges });
    return { nodes, edges, cycles };
  }

  private getDirectDependencies(token: Token): ReadonlyArray<Token> {
    const registration = this.registrations.get(token);
    if (registration === undefined) return [];

    // FactoryProvider: explicit inject list.
    if (registration.injectTokens !== undefined) {
      return registration.injectTokens;
    }

    // ExistingProvider: single alias.
    if (registration.aliasTarget !== undefined) {
      return [registration.aliasTarget];
    }

    // ClassProvider: read paramtypes from the target class (NOT from `token`,
    // since the registered token may be a string while useClass points to
    // a class).
    const classTarget = registration.classTarget;
    if (classTarget !== undefined) {
      const out: Token[] = [];
      const paramTypes = readParamTypes(classTarget);
      const injectTokens = readInjectTokens(classTarget);
      paramTypes.forEach((paramType, i) => {
        const explicit = injectTokens.get(i);
        if (explicit !== undefined) {
          out.push(explicit);
        } else if (!isPrimitiveTypeMarker(paramType)) {
          out.push(paramType as Token);
        }
      });
      return out;
    }

    // ValueProvider has no deps.
    return [];
  }

  /**
   * Dispose the container — runs `dispose()` (or `Symbol.asyncDispose`) on
   * every singleton instance in reverse construction order. Idempotent.
   * Subsequent `resolve()` throws `ContainerDisposedError`.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.disposeInstances(this.singletonInstances);
    this.singletonCache.clear();
  }

  /**
   * Symbol.asyncDispose alias — enables `await using container = new Container(...)`.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: validation
  // ─────────────────────────────────────────────────────────────────────

  private normalizeShorthand<T>(providerOrClass: Provider<T> | ClassConstructor<T>): Provider<T> {
    if (typeof providerOrClass === "function") {
      // Bare class — expand to ClassProvider { provide: X, useClass: X }
      return {
        provide: providerOrClass,
        useClass: providerOrClass,
      };
    }
    return providerOrClass;
  }

  private tokenOf<T>(providerOrClass: Provider<T> | ClassConstructor<T>): Token<T> {
    if (typeof providerOrClass === "function") return providerOrClass;
    return providerOrClass.provide;
  }

  private validateProvider<T>(provider: Provider<T>): void {
    if (provider.provide === undefined || provider.provide === null) {
      throw new TypeError(
        "Provider.provide must be a class or non-empty string token, got: " +
          String(provider.provide),
      );
    }
    if ("useClass" in provider) {
      this.validateClassProvider(provider as ClassProvider<T>);
    }
    // ExistingProvider's target is validated lazily (resolve-time) — the
    // chain may legitimately point to another existing provider not yet
    // registered. ValueProvider needs no validation. FactoryProvider's
    // `inject` tokens are validated lazily.
  }

  /**
   * v1.1 EC-1: shared by both declarative providers: [] AND imperative
   * register() — every class provider must have @Injectable().
   */
  private validateClassProvider<T>(provider: ClassProvider<T>): void {
    if (typeof provider.useClass !== "function") {
      throw new TypeError(
        `ClassProvider.useClass must be a class constructor, got ${typeof provider.useClass}.`,
      );
    }
    if (!isInjectable(provider.useClass)) {
      throw new MissingInjectableError(provider.useClass as { name?: string });
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new ContainerDisposedError();
  }

  /**
   * v1.2 EC-R2-5: container freezes on first resolve. Late registrations
   * require explicit `allowDynamicRegistration: true` (testing escape hatch).
   */
  private assertNotFrozen(token: Token): void {
    if (this.hasResolved && !this.options.allowDynamicRegistration) {
      throw new ContainerFrozenError(token);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: provider normalization to Registration
  // ─────────────────────────────────────────────────────────────────────

  private normalizeProvider<T>(provider: Provider<T>): Registration<T> {
    if ("useClass" in provider) {
      return this.fromClassProvider(provider);
    }
    if ("useFactory" in provider) {
      return this.fromFactoryProvider(provider);
    }
    if ("useValue" in provider) {
      return this.fromValueProvider(provider);
    }
    return this.fromExistingProvider(provider);
  }

  private fromClassProvider<T>(provider: ClassProvider<T>): Registration<T> {
    const target = provider.useClass;
    const scopeFromDecorator = readInjectableMetadata(target)?.scope;
    const scope = provider.scope ?? scopeFromDecorator ?? Scope.SINGLETON;
    return {
      token: provider.provide,
      scope,
      factory: (ctx) => this.constructClassWithAsyncFallback(target, ctx),
      classTarget: target,
    };
  }

  private fromFactoryProvider<T>(provider: FactoryProvider<T>): Registration<T> {
    const injectTokens = provider.inject ?? [];
    return {
      token: provider.provide,
      scope: provider.scope ?? Scope.SINGLETON,
      factory: (ctx) => {
        // Try sync first — fast path when all deps are sync.
        const args: unknown[] = [];
        let needsAsync = false;
        for (const dep of injectTokens) {
          try {
            args.push(ctx.resolve(dep));
          } catch (err) {
            if (err instanceof AsyncProviderInSyncResolveError) {
              needsAsync = true;
              break;
            }
            throw err;
          }
        }
        if (!needsAsync) {
          return provider.useFactory(...args);
        }
        // Async fallback: await every dep, then invoke factory.
        return Promise.all(injectTokens.map((dep) => ctx.resolveAsync(dep))).then((asyncArgs) =>
          provider.useFactory(...asyncArgs),
        );
      },
      injectTokens,
    };
  }

  private fromValueProvider<T>(provider: ValueProvider<T>): Registration<T> {
    return {
      token: provider.provide,
      scope: Scope.SINGLETON,
      factory: () => provider.useValue,
    };
  }

  private fromExistingProvider<T>(provider: ExistingProvider<T>): Registration<T> {
    return {
      token: provider.provide,
      scope: Scope.SINGLETON,
      factory: (ctx) => ctx.resolve(provider.useExisting) as T,
      aliasTarget: provider.useExisting,
    };
  }

  /**
   * Resolve constructor params + build instance. Tries sync first; if any
   * dep is async, falls back to awaiting via `resolveAsync`.
   */
  private constructClassWithAsyncFallback<T>(
    target: ClassConstructor<T>,
    ctx: ResolutionContext,
  ): T | Promise<T> {
    if (!hasReflectMetadata()) {
      throw new ReflectMetadataMissingError();
    }
    const paramTypes = readParamTypes(target);
    const injectTokens = readInjectTokens(target);
    const optionalFlags = readOptionalFlags(target);

    // EC-12 detection: zero paramTypes for a class that declares a non-empty
    // constructor strongly suggests emitDecoratorMetadata is off.
    if (paramTypes.length === 0 && target.length > 0) {
      throw new TypeError(
        `Class ${target.name} has @Injectable() but no constructor metadata. ` +
          'Add `"emitDecoratorMetadata": true` to your tsconfig.json.',
      );
    }

    // Try sync path first.
    const syncArgs: unknown[] = [];
    let needsAsync = false;

    for (let index = 0; index < paramTypes.length; index += 1) {
      const paramType = paramTypes[index];
      const explicit = injectTokens.get(index);
      const isOptional = optionalFlags.has(index);

      const tokenForParam = explicit ?? (paramType as Token);

      if (explicit === undefined && isPrimitiveTypeMarker(paramType)) {
        if (isOptional) {
          syncArgs.push(undefined);
          continue;
        }
        throw new TypeError(
          `Class ${target.name} has a primitive/interface constructor parameter at index ${index} ` +
            `(emitted as ${(paramType as { name?: string }).name ?? "<unknown>"}). ` +
            "Primitives and interfaces cannot be auto-resolved — use `@Inject('SOME_STRING_TOKEN')` to provide an explicit token.",
        );
      }

      try {
        syncArgs.push(this.resolveOrOptional(tokenForParam, ctx, isOptional));
      } catch (err) {
        if (err instanceof AsyncProviderInSyncResolveError) {
          needsAsync = true;
          break;
        }
        throw err;
      }
    }

    if (!needsAsync) {
      return new target(...syncArgs);
    }

    // Async fallback — resolve every dep via resolveAsync, then construct.
    const argPromises: Promise<unknown>[] = paramTypes.map((paramType, index) => {
      const explicit = injectTokens.get(index);
      const isOptional = optionalFlags.has(index);
      const tokenForParam = explicit ?? (paramType as Token);

      if (explicit === undefined && isPrimitiveTypeMarker(paramType)) {
        // Already rejected above in sync pass for non-optional; here it's optional.
        return Promise.resolve(undefined);
      }

      return ctx.resolveAsync(tokenForParam).catch((err: unknown) => {
        if (isOptional && err instanceof TokenNotFoundError) return undefined;
        throw err;
      });
    });

    return Promise.all(argPromises).then((args) => new target(...args));
  }

  private resolveOrOptional<T>(
    token: Token<T>,
    ctx: ResolutionContext,
    isOptional: boolean,
  ): T | undefined {
    try {
      return ctx.resolve(token);
    } catch (err) {
      if (isOptional && err instanceof TokenNotFoundError) return undefined;
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: sync resolution
  // ─────────────────────────────────────────────────────────────────────

  private resolveInContext<T>(token: Token<T>, ctx: ResolutionContext): T {
    // 1. Cycle check FIRST (v1.2 EC-R2-1)
    if (ctx.path.includes(token)) {
      throw new CyclicDependencyError([...ctx.path, token]);
    }

    // 2. Scope-aware cache lookup
    const cached = this.lookupCache(token);
    if (cached !== undefined) {
      if (cached instanceof Promise) {
        // Sync resolve hit an async cached promise → user error.
        throw new AsyncProviderInSyncResolveError(token);
      }
      return cached as T;
    }

    // 3. Materialize
    const registration = this.registrations.get(token);
    if (registration === undefined) {
      throw new TokenNotFoundError(token, ctx.path);
    }

    if (registration.scope === Scope.REQUEST) {
      this.assertRequestActive(token);
    }

    const childCtx = this.createContext([...ctx.path, token]);
    const value = registration.factory(childCtx);

    if (value instanceof Promise) {
      // EC-R3-1: Cache the in-flight Promise BEFORE throwing so the async
      // fallback (constructClassWithAsyncFallback → ctx.resolveAsync) finds
      // it and does NOT call the factory a second time. Without this the
      // factory runs twice — once here (discarded) and once on async retry —
      // doubling resource creation per resolve and leaking the first instance
      // (it never reaches trackInstance, so dispose() never sees it).
      this.storeInCache(token, value, registration.scope);
      value.then(
        (resolved) => {
          this.storeInCache(token, resolved, registration.scope);
          this.trackInstance(resolved, registration.scope);
        },
        () => {
          this.deleteFromCache(token, registration.scope);
        },
      );
      throw new AsyncProviderInSyncResolveError(token);
    }

    this.storeInCache(token, value, registration.scope);
    this.trackInstance(value, registration.scope);
    return value as T;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: async resolution (Promise-lock cache)
  // ─────────────────────────────────────────────────────────────────────

  private async resolveAsyncInContext<T>(token: Token<T>, ctx: ResolutionContext): Promise<T> {
    // 1. Cycle check FIRST (v1.2 EC-R2-1) — BEFORE cache lookup.
    //    Otherwise async cycles hit the in-flight Promise and deadlock.
    if (ctx.path.includes(token)) {
      throw new CyclicDependencyError([...ctx.path, token]);
    }

    // 2. Cache lookup — may return a Promise (in-flight factory) or value.
    const cached = this.lookupCache(token);
    if (cached !== undefined) {
      return cached as T | Promise<T>;
    }

    // 3. Materialize.
    const registration = this.registrations.get(token);
    if (registration === undefined) {
      throw new TokenNotFoundError(token, ctx.path);
    }

    if (registration.scope === Scope.REQUEST) {
      this.assertRequestActive(token);
    }

    const childCtx = this.createContextAsync([...ctx.path, token]);
    const result = registration.factory(childCtx);

    // 4. Store Promise OR value immediately (so concurrent callers wait).
    if (result instanceof Promise) {
      this.storeInCache(token, result, registration.scope);
      // v1.2 EC-R2-2: cleanup cache on rejection — never poison the cache.
      result.then(
        (value) => {
          this.storeInCache(token, value, registration.scope);
          this.trackInstance(value, registration.scope);
        },
        () => {
          this.deleteFromCache(token, registration.scope);
        },
      );
      return result as Promise<T>;
    }
    this.storeInCache(token, result, registration.scope);
    this.trackInstance(result, registration.scope);
    return result as T;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: scope-aware cache helpers
  // ─────────────────────────────────────────────────────────────────────

  private lookupCache(token: Token): unknown {
    if (this.singletonCache.has(token)) return this.singletonCache.get(token);
    const store = this.requestStorage.getStore();
    if (store?.cache.has(token)) return store.cache.get(token);
    return undefined;
  }

  private storeInCache(token: Token, value: unknown, scope: Scope): void {
    if (scope === Scope.SINGLETON) {
      this.singletonCache.set(token, value);
      return;
    }
    if (scope === Scope.REQUEST) {
      const store = this.requestStorage.getStore();
      if (store !== undefined) {
        store.cache.set(token, value);
      }
      return;
    }
    // TRANSIENT — never cached.
  }

  private deleteFromCache(token: Token, scope: Scope): void {
    if (scope === Scope.SINGLETON) {
      this.singletonCache.delete(token);
      return;
    }
    if (scope === Scope.REQUEST) {
      const store = this.requestStorage.getStore();
      store?.cache.delete(token);
    }
  }

  private trackInstance(value: unknown, scope: Scope): void {
    if (!isDisposable(value)) return;
    if (scope === Scope.SINGLETON) {
      this.singletonInstances.push(value);
      return;
    }
    if (scope === Scope.REQUEST) {
      const store = this.requestStorage.getStore();
      store?.instances.push(value);
    }
  }

  private assertRequestActive(token: Token): void {
    if (this.requestStorage.getStore() === undefined) {
      throw new ScopeViolationError(
        token,
        "REQUEST scope requires container.runInRequest(...) to be active.",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: ResolutionContext factories
  // ─────────────────────────────────────────────────────────────────────

  private createContext(path: ReadonlyArray<Token>): ResolutionContext {
    return {
      path,
      resolve: <U>(t: Token<U>): U => this.resolveInContext(t, this.createContext(path)),
      resolveAsync: <U>(t: Token<U>): Promise<U> =>
        this.resolveAsyncInContext(t, this.createContextAsync(path)),
    };
  }

  private createContextAsync(path: ReadonlyArray<Token>): ResolutionContext {
    return {
      path,
      resolve: <U>(t: Token<U>): U => this.resolveInContext(t, this.createContext(path)),
      resolveAsync: <U>(t: Token<U>): Promise<U> =>
        this.resolveAsyncInContext(t, this.createContextAsync(path)),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: disposal
  // ─────────────────────────────────────────────────────────────────────

  private async disposeInstances(instances: Disposable[]): Promise<void> {
    const errors: unknown[] = [];
    // Reverse construction order — dispose dependents before deps.
    for (let i = instances.length - 1; i >= 0; i -= 1) {
      const instance = instances[i];
      if (instance === undefined) continue;
      try {
        const asAsync = (instance as { [Symbol.asyncDispose]?: () => unknown })[
          Symbol.asyncDispose
        ];
        if (typeof asAsync === "function") {
          await asAsync.call(instance);
        } else {
          await instance.dispose();
        }
      } catch (err) {
        errors.push(err);
      }
    }
    instances.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more instances failed to dispose.");
    }
  }
}

function isDisposable(value: unknown): value is Disposable {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { dispose?: unknown; [k: symbol]: unknown };
  if (typeof candidate.dispose === "function") return true;
  if (typeof candidate[Symbol.asyncDispose] === "function") return true;
  return false;
}
