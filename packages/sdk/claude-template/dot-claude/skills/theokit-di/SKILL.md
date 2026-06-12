---
user-invocable: false
description: Dependency injection container, decorators, scopes, and modules for @theokit/di.
paths:
  - "**/*container*"
  - "**/*inject*"
  - "**/*provider*"
  - "**/*module*"
---

# TheoKit DI -- Dependency Injection

Quick reference for `@theokit/di` -- a TypeScript DI container with decorator metadata.

## Installation

```bash
pnpm add @theokit/di reflect-metadata
```

Requires `reflect-metadata` polyfill imported once at app entry and `experimentalDecorators` + `emitDecoratorMetadata` in `tsconfig.json`.

## Core decorators

### @Injectable

```typescript
import { Injectable, Scope } from "@theokit/di";

@Injectable()
class UserRepository {
  findById(id: string) { /* ... */ }
}

// With options:
@Injectable({ scope: Scope.REQUEST })
class RequestScopedService { /* ... */ }
```

`InjectableOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `scope` | `Scope` | `Scope.SINGLETON` | Lifecycle scope. |

### @Inject

```typescript
import { Inject } from "@theokit/di";

@Injectable()
class OrderService {
  constructor(
    @Inject("DATABASE_URL") private readonly dbUrl: string,
    private readonly repo: UserRepository, // auto-resolved by type
  ) {}
}
```

Use `@Inject(token)` for string/symbol tokens. Constructor parameter types are auto-resolved via `reflect-metadata` when the parameter is a class.

### @Optional

```typescript
import { Optional } from "@theokit/di";

@Injectable()
class NotificationService {
  constructor(
    @Optional() private readonly sms?: SmsGateway,
  ) {}
}
```

Resolves to `undefined` instead of throwing `TokenNotFoundError` when the dependency is not registered.

### @Qualifier

```typescript
import { Qualifier } from "@theokit/di";

@Injectable()
class PaymentService {
  constructor(
    @Qualifier("stripe") private readonly gateway: PaymentGateway,
  ) {}
}
```

Disambiguates between multiple providers registered under the same interface token.

### @Primary

```typescript
import { Primary, Injectable } from "@theokit/di";

@Injectable()
@Primary()
class StripeGateway implements PaymentGateway { /* ... */ }
```

Marks a provider as the default when multiple are registered for the same token. Wins over non-primary providers unless `@Qualifier` is used.

### @PostConstruct / @PreDestroy

```typescript
import { PostConstruct, PreDestroy, Injectable } from "@theokit/di";

@Injectable()
class DatabasePool {
  @PostConstruct()
  async init() { /* called after construction */ }

  @PreDestroy()
  async shutdown() { /* called on container.dispose() */ }
}
```

## Container

```typescript
import { Container } from "@theokit/di";

const container = new Container();

// Register classes
container.register(UserRepository);
container.register(OrderService);

// Register value providers
container.register("DATABASE_URL", { useValue: "postgres://..." });

// Register factory providers
container.register("Logger", {
  useFactory: (ctx) => new Logger(ctx.resolve("DATABASE_URL")),
});

// Register existing (alias)
container.register("PrimaryRepo", { useExisting: UserRepository });

// Resolve
const service = container.resolve(OrderService);
const asyncService = await container.resolveAsync(OrderService);

// Dispose (calls @PreDestroy hooks)
await container.dispose();
```

### ContainerOptions

```typescript
interface ContainerOptions {
  parent?: Container;    // hierarchical containers
  autoRegister?: boolean; // default false
}
```

### Provider types

```typescript
type Provider =
  | ClassProvider      // { useClass: Constructor, scope? }
  | ValueProvider      // { useValue: any }
  | FactoryProvider    // { useFactory: (ctx) => any, scope? }
  | ExistingProvider;  // { useExisting: Token }
```

## Scopes

```typescript
import { Scope } from "@theokit/di";
```

| Scope | Behavior |
|---|---|
| `Scope.SINGLETON` | One instance per container (default). |
| `Scope.TRANSIENT` | New instance on every resolve. |
| `Scope.REQUEST` | One instance per request scope (via `container.createScope()`). |

Request scope example:

```typescript
const requestContainer = container.createScope();
const handler = requestContainer.resolve(RequestHandler);
// All REQUEST-scoped deps share the same instance within this scope
```

## @Module

```typescript
import { Module } from "@theokit/di";

@Module({
  providers: [UserRepository, OrderService],
  imports: [DatabaseModule],
  exports: [UserRepository],
})
class UserModule {}

// Load module into container
container.loadModule(UserModule);
```

`ModuleMetadata`:

| Field | Type | Description |
|---|---|---|
| `providers` | `Provider[]` | Classes/providers registered in this module. |
| `imports` | `Module[]` | Other modules whose exports become available. |
| `exports` | `Token[]` | Tokens visible to importing modules. |

## Errors

| Error | Cause |
|---|---|
| `TokenNotFoundError` | Token not registered and not `@Optional`. |
| `CyclicDependencyError` | Circular dependency detected in resolution graph. |
| `MissingInjectableError` | Class used as dependency without `@Injectable`. |
| `ScopeViolationError` | Singleton depends on transient/request-scoped dep. |
| `ContainerDisposedError` | Resolve called after `container.dispose()`. |
| `ContainerFrozenError` | Register called after container is frozen. |
| `AsyncProviderInSyncResolveError` | Async factory used with `resolve()` instead of `resolveAsync()`. |
| `ReflectMetadataMissingError` | `reflect-metadata` polyfill not imported. |
| `CyclicModuleImportError` | Circular module imports detected. |
| `InvalidModuleError` | Module class missing `@Module` decorator. |
| `InvalidExportError` | Module exports a token not in its providers. |

## Graph analysis

```typescript
const graph: DependencyGraph = container.analyzeGraph();
// Useful for debugging dependency chains and detecting issues
```
