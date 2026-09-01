import { afterEach, describe, expect, it, vi } from "vitest";
import { TheoKitClient } from "../src/client/theokit-client.js";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("TheoKitClient", () => {
  it("send posts to /agent/send with correct body", async () => {
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toEqual("http://localhost:3000/agent/send");
      expect(init.method).toEqual("POST");
      const body = JSON.parse(init.body as string);
      expect(body.input).toEqual("hello");
      return new Response(JSON.stringify({ status: "finished", output: "hi" }));
    }) as unknown as typeof fetch;

    const client = new TheoKitClient({ baseUrl: "http://localhost:3000" });
    const result = await client.send("hello");
    expect(result.status).toEqual("finished");
    expect(result.output).toEqual("hi");
  });

  it("send throws on non-OK response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("error", { status: 500 }),
    ) as unknown as typeof fetch;

    const client = new TheoKitClient({ baseUrl: "http://localhost:3000" });
    await expect(client.send("fail")).rejects.toThrow("status 500");
  });

  it("stream returns async iterable of SSE events", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"text","text":"hello"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"text","text":"world"}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const client = new TheoKitClient({ baseUrl: "http://localhost:3000" });
    const events: unknown[] = [];
    for await (const event of client.stream("hi")) {
      events.push(event);
    }
    expect(events.length).toEqual(2);
    expect(events[0]).toEqual({ type: "text", text: "hello" });
  });

  it("respects custom basePath", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).toEqual("http://localhost:3000/api/v1/send");
      return new Response(JSON.stringify({ status: "finished" }));
    }) as unknown as typeof fetch;

    const client = new TheoKitClient({ baseUrl: "http://localhost:3000", basePath: "/api/v1" });
    await client.send("test");
  });

  it("forwards custom headers", async () => {
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Custom"]).toEqual("value");
      return new Response(JSON.stringify({ status: "finished" }));
    }) as unknown as typeof fetch;

    const client = new TheoKitClient({
      baseUrl: "http://localhost:3000",
      headers: { "X-Custom": "value" },
    });
    await client.send("test");
  });

  it("has zero node: imports (browser-safe)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const clientSrc = readFileSync(join(__dirname, "../src/client/theokit-client.ts"), "utf-8");
    expect(clientSrc).not.toMatch(/from\s+["']node:/);
  });
});
