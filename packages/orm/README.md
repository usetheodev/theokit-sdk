# @usetheo/orm

Repository pattern + `@InjectRepository` decorator + agent-aware columns + `@Transactional` + schema export polyglot over `drizzle-orm`, consuming `@usetheo/di` for inversion of control.

NestJS TypeORM-equivalent DX for the theokit ecosystem, but built on Drizzle (Apache-2.0, edge-runtime ready, zero codegen).

## Install

```bash
pnpm add @usetheo/orm @usetheo/di reflect-metadata drizzle-orm
pnpm add -D drizzle-kit
```

Your `tsconfig.json` MUST enable:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quickstart

```typescript
import "reflect-metadata";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { Container, Injectable } from "@usetheo/di";
import { OrmModule, Repository, InjectRepository } from "@usetheo/orm";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agentId: text("agent_id"),
});

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema: { users } });

const container = new Container({
  providers: [
    ...OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db }),
    ...OrmModule.forFeature([users]),
  ],
});

@Injectable()
class UserService {
  constructor(@InjectRepository(users) private readonly repo: Repository<typeof users>) {}

  async create(id: string, name: string) {
    return this.repo.insert({ id, name });
  }

  async list() {
    return this.repo.findMany();
  }
}
```

## Agent-aware columns

Wrap a flow with `withAgentContext({...})` and any column matching `agentId`, `runId`, or `conversationId` will be auto-filled on `insert`/`update`:

```typescript
import { withAgentContext } from "@usetheo/orm";

await withAgentContext({ agentId: "agent-123", runId: "run-456" }, async () => {
  await repo.insert({ id: "u1", name: "Ada" });
  // → row.agent_id = "agent-123", row.run_id = "run-456"
});
```

## Transactions

```typescript
import { Transactional } from "@usetheo/orm";

@Injectable()
class TransferService {
  constructor(
    @InjectRepository(accounts) private readonly accountsRepo: Repository<typeof accounts>,
  ) {}

  @Transactional()
  async transfer(from: string, to: string, amount: number) {
    // rollback automatically on throw
  }
}
```

## Schema export (polyglot)

```typescript
import { exportSchemas } from "@usetheo/orm/schema-export";

const schemas = exportSchemas({ users });
// schemas.users is JSON Schema 7 — consumable by SQLAlchemy, Tortoise, Pydantic, etc.
```

## License

Apache-2.0
