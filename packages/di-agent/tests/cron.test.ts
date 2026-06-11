import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Cron, readCronMetadata } from "../src/decorators/cron.js";

describe("@Cron", () => {
  it("stores schedule and method key", () => {
    class A {
      @Cron({ schedule: "*/5 * * * *" })
      async run(): Promise<void> {}
    }
    const meta = readCronMetadata(A);
    expect(meta?.schedule).toBe("*/5 * * * *");
    expect(meta?.methodKey).toBe("run");
  });
  it("stores timezone", () => {
    class A {
      @Cron({ schedule: "0 9 * * *", timezone: "America/Sao_Paulo" })
      async job(): Promise<void> {}
    }
    expect(readCronMetadata(A)?.timezone).toBe("America/Sao_Paulo");
  });
  it("returns undefined without decorator", () => {
    class Plain {}
    expect(readCronMetadata(Plain)).toBeUndefined();
  });
  it("last @Cron wins", () => {
    class A {
      @Cron({ schedule: "first" })
      async a(): Promise<void> {}
      @Cron({ schedule: "second" })
      async b(): Promise<void> {}
    }
    expect(readCronMetadata(A)?.schedule).toBe("second");
    expect(readCronMetadata(A)?.methodKey).toBe("b");
  });
  it("isolates between classes", () => {
    class A {
      @Cron({ schedule: "a" }) async r(): Promise<void> {}
    }
    class B {
      @Cron({ schedule: "b" }) async r(): Promise<void> {}
    }
    expect(readCronMetadata(A)?.schedule).toBe("a");
    expect(readCronMetadata(B)?.schedule).toBe("b");
  });
  it("works on sync method", () => {
    class A {
      @Cron({ schedule: "* * * * *" }) run(): void {}
    }
    expect(readCronMetadata(A)?.methodKey).toBe("run");
  });
  it("stores invalid expression as-is (EC-1)", () => {
    class A {
      @Cron({ schedule: "not-a-cron" }) run(): void {}
    }
    expect(readCronMetadata(A)?.schedule).toBe("not-a-cron");
  });
});
