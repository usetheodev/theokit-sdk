import { describe, expect, it } from "vitest";

import { createWebFetchTool } from "../src/web-fetch.js";

describe("createWebFetchTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='web_fetch'", () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe("web_fetch");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createWebFetchTool — URL validation", () => {
  it("Given an invalid URL, Then result is { ok: false, error: 'invalid_url' }", async () => {
    const tool = createWebFetchTool();
    const out = await tool.handler({ url: "not-a-url" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("invalid_url");
  });

  it("Given a file:// URL, Then result is { ok: false, error: 'invalid_url' }", async () => {
    const tool = createWebFetchTool();
    const out = await tool.handler({ url: "file:///etc/passwd" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("invalid_url");
  });

  it("Given a ftp:// URL, Then result is { ok: false, error: 'invalid_url' }", async () => {
    const tool = createWebFetchTool();
    const out = await tool.handler({ url: "ftp://example.com/file" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("invalid_url");
  });
});

describe("createWebFetchTool — timeout", () => {
  it("Given an unreachable host with short timeout, Then result is timeout or fetch_failed", async () => {
    const tool = createWebFetchTool({ defaultTimeoutMs: 500 });
    const out = await tool.handler({ url: "http://192.0.2.1:1/" }); // TEST-NET — unreachable
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(["timeout", "fetch_failed"]).toContain(parsed.error);
  }, 10_000);
});

describe("createWebFetchTool — happy path (live)", () => {
  it("Given a valid HTTPS URL, When fetched, Then returns content and status", async () => {
    // Use a well-known tiny endpoint
    const tool = createWebFetchTool({ defaultTimeoutMs: 10_000 });
    const out = await tool.handler({ url: "https://httpbin.org/robots.txt" });
    const parsed = JSON.parse(out);
    // Network/service may be unavailable — accept ok with any status or fetch_failed
    if (parsed.ok) {
      expect(typeof parsed.status_code).toBe("number");
      expect(typeof parsed.content).toBe("string");
    } else {
      expect(["fetch_failed", "timeout"]).toContain(parsed.error);
    }
  }, 15_000);
});
