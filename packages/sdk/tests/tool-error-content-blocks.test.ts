import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import type { ToolResultContentBlock } from "../src/index.js";
import { Agent, ConfigurationError, ToolError } from "../src/index.js";
import { applyToolResultGuard } from "../src/internal/agent-loop/tool-result-guard.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

import {
  toBlockToolResultContent,
  toStringToolResultContent,
} from "../src/internal/llm/tool-result-content.js";

/**
 * SE7 — structured/multimodal tool results + ToolError. A tool may RETURN content blocks (text +
 * image) on success and THROW a ToolError carrying blocks on failure. Block-capable providers carry
 * them natively; string-only providers fail fast with a typed ConfigurationError. The helpers are
 * named by CAPABILITY (block vs string), not by provider.
 *
 * TDD RED-first.
 */

const IMG: ToolResultContentBlock = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "AAAA" },
};
const TXT: ToolResultContentBlock = { type: "text", text: "rendered chart" };

describe("ToolError (SE7)", () => {
  it("carries a string message", () => {
    const e = new ToolError("bad url");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ToolError");
    expect(e.content).toBe("bad url");
    expect(e.message).toContain("bad url");
    expect(e.isRetryable).toBe(false);
  });

  it("carries content blocks and renders them into the Error message", () => {
    const e = new ToolError([TXT, IMG]);
    expect(e.content).toEqual([TXT, IMG]);
    // The Error.message is a text rendering (image → a short placeholder).
    expect(e.message).toContain("rendered chart");
    expect(e.message).toMatch(/image\/png/);
  });
});

describe("block-capable providers (SE7) — content blocks pass through", () => {
  it("keeps a string tool_result content unchanged (back-compat)", () => {
    expect(toBlockToolResultContent("plain")).toBe("plain");
  });

  it("passes structured text + image blocks through for a block-capable wire", () => {
    expect(toBlockToolResultContent([TXT, IMG])).toEqual([
      { type: "text", text: "rendered chart" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });
});

describe("string-only providers (SE7) — flatten text, fail fast on images", () => {
  it("passes a string through", () => {
    expect(toStringToolResultContent("hi", "openai")).toBe("hi");
  });

  it("flattens text-only blocks to a joined string", () => {
    expect(toStringToolResultContent([TXT, { type: "text", text: "line2" }], "openai")).toBe(
      "rendered chart\nline2",
    );
  });

  it("FAILS FAST on an image block (typed ConfigurationError, no silent drop)", () => {
    expect(() => toStringToolResultContent([TXT, IMG], "openai")).toThrow(ConfigurationError);
    expect(() => toStringToolResultContent([IMG], "ollama")).toThrow(
      /ollama.*image content in tool results/i,
    );
  });
});

describe("tool-result guard (SE7) — structured content: redact text, pass images", () => {
  it("delimits/redacts the TEXT blocks of a structured result and leaves images untouched", () => {
    const parts = [
      {
        type: "tool_result" as const,
        toolUseId: "tu-1",
        content: [
          { type: "text" as const, text: "email me at a@b.com" },
          IMG,
        ] as ToolResultContentBlock[],
      },
    ];
    const [guarded] = applyToolResultGuard(parts, { redactPii: true });
    const content = (guarded as { content: ToolResultContentBlock[] }).content;
    // text block redacted…
    expect((content[0] as { text: string }).text).not.toContain("a@b.com");
    // …image block untouched.
    expect(content[1]).toEqual(IMG);
  });
});

// ── Integration: a real run over a stub, capturing the outbound tool_result ────

interface StubResult {
  server: Server;
  url: string;
  bodies: unknown[];
}

function startStub(toolName: string): Promise<StubResult> {
  const bodies: unknown[] = [];
  let call = 0;
  const enc = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.url !== "/v1/messages") {
        res.statusCode = 404;
        res.end();
        return;
      }
      bodies.push(JSON.parse(raw));
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(enc("message_start", "{}"));
      call += 1;
      if (call === 1) {
        res.write(
          enc(
            "content_block_start",
            JSON.stringify({
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu-1", name: toolName, input: {} },
            }),
          ),
        );
        res.write(
          enc(
            "content_block_delta",
            JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: "{}" },
            }),
          ),
        );
        res.write(
          enc("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })),
        );
        res.write(
          enc(
            "message_delta",
            JSON.stringify({
              type: "message_delta",
              delta: { stop_reason: "tool_use" },
              usage: { input_tokens: 10, output_tokens: 5 },
            }),
          ),
        );
      } else {
        res.write(
          enc(
            "content_block_delta",
            JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "done" },
            }),
          ),
        );
        res.write(
          enc(
            "message_delta",
            JSON.stringify({
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { input_tokens: 20, output_tokens: 5 },
            }),
          ),
        );
      }
      res.write(enc("message_stop", "{}"));
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (typeof a !== "object" || a === null) throw new Error("bind failed");
      resolve({ server, url: `http://127.0.0.1:${a.port}`, bodies });
    });
  });
}

/** Find the tool_result content block sent back to the provider on the 2nd request. */
function toolResultFrom(bodies: unknown[]): Record<string, unknown> | undefined {
  const second = bodies[1] as { messages?: Array<{ content?: unknown }> } | undefined;
  for (const m of second?.messages ?? []) {
    const parts = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
    const tr = parts.find((p) => p.type === "tool_result");
    if (tr !== undefined) return tr;
  }
  return undefined;
}

async function drive(handlerOrThrow: () => string | ToolResultContentBlock[]): Promise<unknown[]> {
  const stub = await startStub("shoot");
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevUrl = process.env.ANTHROPIC_API_BASE_URL;
  // The env key is the credential the stub receives; `apiKey: "real-not-fixture"`
  // is the sentinel that forces the REAL local runtime (a fixture-shaped key like
  // "sk-stub" would route to fixture mode and never hit the stub server).
  process.env.ANTHROPIC_API_KEY = "sk-stub";
  process.env.ANTHROPIC_API_BASE_URL = stub.url;
  try {
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "shoot",
          description: "Takes a screenshot (SE7 test).",
          inputSchema: { type: "object", properties: {} },
          handler: () => handlerOrThrow(),
        },
      ],
    });
    const run = await agent.send("go");
    for await (const _ of run.stream()) {
      // drain
    }
    agent.dispose();
    return stub.bodies;
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    stub.server.close();
  }
}

describe("tool_result content blocks (SE7) — end-to-end onto a block-capable wire", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("carries a handler-returned image block onto the outbound tool_result (success)", async () => {
    const bodies = await drive(() => [{ type: "text", text: "shot" }, IMG]);
    const tr = toolResultFrom(bodies);
    expect(tr).toBeDefined();
    expect(tr?.content).toEqual([
      { type: "text", text: "shot" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
    expect(tr?.is_error).toBeUndefined();
  });

  it("carries a ToolError's blocks onto the outbound tool_result with is_error (failure)", async () => {
    const bodies = await drive(() => {
      throw new ToolError([{ type: "text", text: "boom" }, IMG]);
    });
    const tr = toolResultFrom(bodies);
    expect(tr).toBeDefined();
    expect(tr?.is_error).toBe(true);
    expect(tr?.content).toEqual([
      { type: "text", text: "boom" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("keeps a string ToolError as a string on the wire (symmetric with a string return)", async () => {
    const bodies = await drive(() => {
      throw new ToolError("bad url");
    });
    const tr = toolResultFrom(bodies);
    expect(tr).toBeDefined();
    expect(tr?.is_error).toBe(true);
    expect(tr?.content).toBe("bad url");
  });
});
