import { describe, expect, it, vi } from "vitest";

import { AliasCache } from "../src/alias.js";
import { ConfigurationError } from "../src/errors.js";

describe("AliasCache (D419)", () => {
  it("passes through room id starting with '!'", async () => {
    const client = {
      getRoomIdForAlias: vi.fn(async () => ({ room_id: "should-not-be-called" })),
    };
    const cache = new AliasCache();
    expect(await cache.resolve(client, "!abc:server")).toBe("!abc:server");
    expect(client.getRoomIdForAlias).not.toHaveBeenCalled();
  });

  it("resolves alias starting with '#' via client", async () => {
    const client = {
      getRoomIdForAlias: vi.fn(async () => ({ room_id: "!resolved:server" })),
    };
    const cache = new AliasCache();
    const result = await cache.resolve(client, "#general:matrix.org");
    expect(result).toBe("!resolved:server");
    expect(client.getRoomIdForAlias).toHaveBeenCalledWith("#general:matrix.org");
  });

  it("caches resolved aliases", async () => {
    const client = {
      getRoomIdForAlias: vi.fn(async () => ({ room_id: "!resolved:server" })),
    };
    const cache = new AliasCache();
    await cache.resolve(client, "#general:matrix.org");
    await cache.resolve(client, "#general:matrix.org");
    expect(client.getRoomIdForAlias).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);
  });

  it("throws ConfigurationError on invalid prefix", async () => {
    const client = {
      getRoomIdForAlias: vi.fn(async () => ({ room_id: "!r:s" })),
    };
    const cache = new AliasCache();
    await expect(cache.resolve(client, "general:matrix.org")).rejects.toThrow(ConfigurationError);
  });

  it("clear() empties the cache", async () => {
    const client = {
      getRoomIdForAlias: vi.fn(async () => ({ room_id: "!resolved:server" })),
    };
    const cache = new AliasCache();
    await cache.resolve(client, "#alpha:server");
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
    await cache.resolve(client, "#alpha:server");
    expect(client.getRoomIdForAlias).toHaveBeenCalledTimes(2);
  });
});
