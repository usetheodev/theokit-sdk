import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { PostConstruct, PreDestroy } from "../src/decorators/lifecycle.js";
import { METADATA_KEYS } from "../src/internal/metadata.js";

describe("@PostConstruct decorator", () => {
  it("stores method name in metadata", () => {
    class Service {
      @PostConstruct
      init() {}
    }
    const method = Reflect.getMetadata(METADATA_KEYS.POST_CONSTRUCT, Service);
    expect(method).toBe("init");
  });

  it("works with async methods", () => {
    class Service {
      @PostConstruct
      async warmup() {}
    }
    const method = Reflect.getMetadata(METADATA_KEYS.POST_CONSTRUCT, Service);
    expect(method).toBe("warmup");
  });
});

describe("@PreDestroy decorator", () => {
  it("stores method name in metadata", () => {
    class Service {
      @PreDestroy
      cleanup() {}
    }
    const method = Reflect.getMetadata(METADATA_KEYS.PRE_DESTROY, Service);
    expect(method).toBe("cleanup");
  });

  it("works with async methods", () => {
    class Service {
      @PreDestroy
      async close() {}
    }
    const method = Reflect.getMetadata(METADATA_KEYS.PRE_DESTROY, Service);
    expect(method).toBe("close");
  });
});
