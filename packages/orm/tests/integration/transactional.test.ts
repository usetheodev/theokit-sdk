import { describe, expect, it } from "vitest";
import { OrmConfigurationError, Transactional } from "../../src/index.js";
import { getTxContext } from "../../src/internal/tx-context.js";
import { bindDataSourceToInstance } from "../../src/transactional.js";
import type { DataSource } from "../../src/types.js";

/**
 * Async-friendly mock that mirrors the drizzle pg/mysql contract:
 *   db.transaction(async (tx) => result) → Promise<result>
 * Records committed/rolled-back ops so we can assert rollback semantics
 * without depending on a specific driver. better-sqlite3 has sync-only
 * transactions which are not the @Transactional target; for the sync
 * driver, consumers use repo.query() directly inside their own callback.
 */
function makeMockDataSource(): {
  ds: DataSource;
  committedOps: string[];
  rolledBackOps: string[];
} {
  const committedOps: string[] = [];
  const rolledBackOps: string[] = [];
  const db = {
    transaction: async (cb: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      const tempOps: string[] = [];
      const tx = {
        _record: (op: string) => tempOps.push(op),
      };
      try {
        const out = await cb(tx);
        committedOps.push(...tempOps);
        return out;
      } catch (err) {
        rolledBackOps.push(...tempOps);
        throw err;
      }
    },
  };
  return {
    ds: {
      name: "default",
      dialect: "pg",
      schema: {},
      db,
    },
    committedOps,
    rolledBackOps,
  };
}

class CommitService {
  @Transactional()
  async doWork(op: string): Promise<string> {
    const tx = getTxContext() as { _record: (op: string) => void };
    tx._record(op);
    return op;
  }
}

class FailingService {
  @Transactional()
  async failWork(op: string): Promise<void> {
    const tx = getTxContext() as { _record: (op: string) => void };
    tx._record(op);
    throw new Error("simulated failure");
  }
}

describe("@Transactional", () => {
  it("commits on success and returns the method's resolved value", async () => {
    const { ds, committedOps, rolledBackOps } = makeMockDataSource();
    const svc = new CommitService();
    bindDataSourceToInstance(svc, ds);
    const out = await svc.doWork("op-1");
    expect(out).toBe("op-1");
    expect(committedOps).toEqual(["op-1"]);
    expect(rolledBackOps).toEqual([]);
  });

  it("rolls back on throw and re-throws the original error", async () => {
    const { ds, committedOps, rolledBackOps } = makeMockDataSource();
    const svc = new FailingService();
    bindDataSourceToInstance(svc, ds);
    await expect(svc.failWork("op-bad")).rejects.toThrow("simulated failure");
    expect(committedOps).toEqual([]);
    expect(rolledBackOps).toEqual(["op-bad"]);
  });

  it("propagates the tx via getTxContext inside the wrapped method", async () => {
    const { ds } = makeMockDataSource();
    let captured: unknown;
    class Probe {
      @Transactional()
      async run(): Promise<void> {
        captured = getTxContext();
      }
    }
    const p = new Probe();
    bindDataSourceToInstance(p, ds);
    await p.run();
    expect(captured).toBeDefined();
  });

  describe("EC-9 — non-DI-managed instance", () => {
    it("throws OrmConfigurationError with actionable message", async () => {
      const svc = new CommitService();
      // intentionally NOT binding DataSource
      await expect(svc.doWork("op")).rejects.toThrow(OrmConfigurationError);
      await expect(svc.doWork("op")).rejects.toThrow(/DI-managed/);
    });
  });

  describe("driver compat", () => {
    it("throws when DataSource.db does not expose .transaction()", async () => {
      const svc = new CommitService();
      bindDataSourceToInstance(svc, {
        name: "default",
        dialect: "pg",
        schema: {},
        db: {
          /* no transaction */
        },
      });
      await expect(svc.doWork("op")).rejects.toThrow(OrmConfigurationError);
      await expect(svc.doWork("op")).rejects.toThrow(/\.transaction\(\)/);
    });
  });

  describe("decorator validation", () => {
    it("throws OrmConfigurationError when applied to non-method", () => {
      expect(() => {
        const dec = Transactional();
        dec({}, "x", { value: "not a function" } as PropertyDescriptor);
      }).toThrow(OrmConfigurationError);
    });
  });
});
