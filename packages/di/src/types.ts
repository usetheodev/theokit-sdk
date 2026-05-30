/**
 * Public type contract for `@usetheo/di`. All consumer-facing types live
 * here; internal types live in `src/internal/`.
 */

/**
 * Constructor of a class — what TypeScript emits for `class X { ... }`.
 * Used as a Class-token (per ADR D2).
 */
// biome-ignore lint/suspicious/noExplicitAny: constructor arg types are intentionally `any[]` so any class fits
export type ClassConstructor<T = unknown> = new (...args: any[]) => T;

/**
 * Token: anything that identifies a dependency in the container.
 *
 * Per ADR D2: Class primary (auto-resolution via `reflect-metadata`),
 * String fallback (for primitives / interfaces). Symbol explicitly NOT
 * supported in v1 (deferred to v2 if real demand surfaces).
 */
export type Token<T = unknown> = ClassConstructor<T> | string;

/**
 * Lifecycle scope (per ADR D5). The container honors three modes:
 *
 * - `SINGLETON` — single instance shared across the entire container
 * - `TRANSIENT` — fresh instance per resolve
 * - `REQUEST` — single instance per `container.runInRequest(...)` boundary
 *   (uses Node's `AsyncLocalStorage`)
 */
export const Scope = {
  SINGLETON: "singleton",
  TRANSIENT: "transient",
  REQUEST: "request",
} as const;

export type Scope = (typeof Scope)[keyof typeof Scope];

/**
 * Tells the container HOW to materialize a value for a token.
 * Exactly one of `useClass | useFactory | useValue | useExisting` MUST be set.
 */
export type Provider<T = unknown> =
  | ClassProvider<T>
  | FactoryProvider<T>
  | ValueProvider<T>
  | ExistingProvider<T>;

export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: ClassConstructor<T>;
  scope?: Scope;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  // biome-ignore lint/suspicious/noExplicitAny: factory deps are dynamic by definition
  useFactory: (...deps: any[]) => T | Promise<T>;
  inject?: ReadonlyArray<Token>;
  scope?: Scope;
}

export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
}

export interface ExistingProvider<T = unknown> {
  provide: Token<T>;
  useExisting: Token<T>;
}

/**
 * Resolution context passed to factories. Mostly internal but exposed so
 * factories can `inject` siblings without hard-coding container references.
 */
export interface ResolutionContext {
  /** The current resolution path (used for cycle detection). */
  readonly path: ReadonlyArray<Token>;
  /** Synchronously resolve a token within the same context. */
  resolve<U>(token: Token<U>): U;
  /** Asynchronously resolve a token within the same context. */
  resolveAsync<U>(token: Token<U>): Promise<U>;
}

/**
 * Options passed to `new Container({...})`.
 */
export interface ContainerOptions {
  /**
   * Declarative providers seed (NestJS-style). Same effect as calling
   * `container.register(provider)` for each entry.
   */
  providers?: ReadonlyArray<Provider | ClassConstructor>;
  /**
   * When `true`, allows `register()` / `registerModule()` calls AFTER
   * the first `resolve()`. Default `false` — fail-fast on misuse.
   *
   * v1.2 EC-R2-5: containers freeze after first resolve to prevent
   * subtle bugs where a singleton is constructed with one set of
   * registrations and a different set is added later.
   */
  allowDynamicRegistration?: boolean;
}

/**
 * Anything that implements a `dispose()` method participates in lifecycle
 * cleanup when the container or REQUEST scope ends.
 */
export interface Disposable {
  dispose(): void | Promise<void>;
}

/**
 * `analyze()` debug return shape (per ADR D7).
 */
export interface DependencyGraph {
  nodes: ReadonlyArray<{
    token: Token;
    scope: Scope;
    isAsync: boolean;
  }>;
  edges: ReadonlyArray<{
    from: Token;
    to: Token;
  }>;
  cycles: ReadonlyArray<ReadonlyArray<Token>>;
}
