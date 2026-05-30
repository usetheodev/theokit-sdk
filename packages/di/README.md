# @usetheo/di

> Lightweight TypeScript dependency injection container for the theokit ecosystem.

NestJS-compatible API (`@Injectable`, `@Inject`, `@Module`, `providers: []`) with three lifecycle scopes (SINGLETON, TRANSIENT, REQUEST via AsyncLocalStorage). Foundation for [`@usetheo/orm`](../orm) and [`@usetheo/http-decorators`](../http-decorators). Agent-aware integration via the companion [`@usetheo/di-agent`](../di-agent) package.

**Status:** initial release (`0.1.0-next.0` on npm `next` tag — promote to `latest` after 1-2 weeks dogfood).

## Install

```bash
pnpm add @usetheo/di reflect-metadata
```

Then import `reflect-metadata` ONCE at your app entry point:

```typescript
import "reflect-metadata";
```

## TypeScript configuration

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Without these flags, decorator metadata is not emitted and the container cannot auto-resolve constructor parameters.

## Quick start

```typescript
import "reflect-metadata";
import { Container, Injectable, Module } from "@usetheo/di";

@Injectable()
class GreeterService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

@Module({
  providers: [GreeterService],
})
class AppModule {}

const container = new Container();
container.registerModule(AppModule);

const greeter = container.resolve(GreeterService);
console.log(greeter.greet("world")); // Hello, world!
```

## Polyglot strategy

`@usetheo/di` is **intentionally TS-only**. DI containers are language-specific runtime constructs — Python uses `inspect`/`typing.get_type_hints`, Go uses `reflect`, etc. The cross-language story for the theokit ecosystem lives in the **contract layer** (OpenAPI from `@usetheo/http-decorators`, SQL migrations + JSON schemas from `@usetheo/orm`), not in the container. See ADR D11 of the implementation plan.

## License

Apache-2.0
