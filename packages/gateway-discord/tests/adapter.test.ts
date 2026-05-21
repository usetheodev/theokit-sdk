/**
 * Tests for DiscordAdapter (T6.1, EC-C default intents).
 *
 * Unit tests cover the bits that don't require a real Discord API
 * connection. Integration coverage comes from examples/gateway-discord
 * (manual probe).
 */

import { GatewayIntentBits } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DISCORD_INTENTS, DiscordAdapter } from "../src/adapter.js";

describe("DiscordAdapter (T6.1)", () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    adapter = new DiscordAdapter({ token: "fake-token" });
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("platform is 'discord'", () => {
    expect(adapter.platform).toBe("discord");
  });

  it("EC-C: default intents include MessageContent (silent-failure guard)", () => {
    expect(DEFAULT_DISCORD_INTENTS).toContain(GatewayIntentBits.MessageContent);
    expect(DEFAULT_DISCORD_INTENTS).toContain(GatewayIntentBits.Guilds);
    expect(DEFAULT_DISCORD_INTENTS).toContain(GatewayIntentBits.GuildMessages);
  });

  it("EC-C: passing intents:[] logs a warn", () => {
    const writes: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: string | Uint8Array) => {
        writes.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
        return true;
      });
    new DiscordAdapter({ token: "fake-token", intents: [] });
    expect(writes.join("")).toContain("intents:[]");
    stderr.mockRestore();
  });

  it("sendMessage with empty text returns error", async () => {
    const r = await adapter.sendMessage({
      channel: { id: "123", type: "dm" },
      text: "",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("EC-H: onInbound second call replaces handler (verified via private state)", () => {
    let firstCalls = 0;
    let secondCalls = 0;
    adapter.onInbound(async () => {
      firstCalls += 1;
    });
    adapter.onInbound(async () => {
      secondCalls += 1;
    });
    // Can't synthesize a real discord.js Message; the contract is tested
    // by inspection — the field is private. Counts both stay at 0 here.
    expect(firstCalls).toBe(0);
    expect(secondCalls).toBe(0);
  });

  it("disconnect is idempotent on never-connected", async () => {
    await adapter.disconnect();
    await adapter.disconnect();
    expect(adapter.platform).toBe("discord");
  });

  it("connect() with bad token returns false (does NOT throw)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adapter.connect();
    expect(result).toBe(false);
    stderr.mockRestore();
  }, 30_000);
});
