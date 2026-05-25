/**
 * `WhatsAppWebBackend` tests (T3.3 + EC-6, EC-11).
 *
 * Uses a controllable fake child process so we don't depend on whatsapp-web.js
 * or Puppeteer in unit tests.
 */

import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";
import { WhatsAppWebBackend } from "../src/backend/web/index.js";
import type { BridgeHandle } from "../src/backend/web/lifecycle.js";
import { WhatsAppConnectTimeoutError } from "../src/errors.js";

/** A fake `ChildProcess` we can drive from tests. */
class FakeChild extends EventEmitter {
  pid = 12345;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdin = new (class extends Writable {
    written: string[] = [];
    override destroyed = false;
    override _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
      this.written.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      cb();
    }
  })();
  readonly stdout = new Readable({ read() {} });
  readonly stderr = new Readable({ read() {} });

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.signalCode = "SIGTERM";
    this.exitCode = 0;
    process.nextTick(() => this.emit("exit", 0, "SIGTERM"));
    return true;
  }
}

function makeHandle(): { handle: BridgeHandle; child: FakeChild } {
  const child = new FakeChild();
  const handle: BridgeHandle = {
    child: child as unknown as BridgeHandle["child"],
    pidFilePath: "/tmp/fake.pid",
  };
  return { handle, child };
}

function feed(child: FakeChild, line: string): void {
  child.stdout.push(line);
}

describe("WhatsAppWebBackend — connect", () => {
  it("test_web_backend_connect_spawns_and_awaits_ready", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const connectPromise = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511999999999"}\n');
    expect(await connectPromise).toBe(true);
    await backend.disconnect();
  });

  it("test_web_backend_connect_times_out_after_120s (EC-6)", async () => {
    const { handle } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 50, // short for the test
    });
    await expect(backend.connect()).rejects.toBeInstanceOf(WhatsAppConnectTimeoutError);
  });
});

describe("WhatsAppWebBackend — send + IPC dispatch", () => {
  it("test_web_backend_send_matches_ack_by_msgid", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
      sendTimeoutMs: 500,
    });
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    const sendP = backend.send({ to: "5511", isGroup: false, text: "hi" });
    // Wait for the bridge to write the command, then feed back an ack.
    await new Promise((r) => setTimeout(r, 10));
    const written = child.stdin.written[0]!;
    const cmd = JSON.parse(written) as { msgId: string };
    feed(
      child,
      JSON.stringify({ event: "send_ack", msgId: cmd.msgId, success: true, wamid: "wamid.acked" }) +
        "\n",
    );

    const r = await sendP;
    expect(r.ok).toBe(true);
    expect(r.wamid).toBe("wamid.acked");
    await backend.disconnect();
  });

  it("test_web_backend_send_times_out", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
      sendTimeoutMs: 50,
    });
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    const r = await backend.send({ to: "5511", isGroup: false, text: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("timeout");
    await backend.disconnect();
  });

  it("test_web_backend_dispatches_inbound_message", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const handler = vi.fn(async () => {});
    backend.onInbound(handler);
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    feed(
      child,
      `${JSON.stringify({
        event: "message",
        msgId: "wamid.in.1",
        from: "5511888",
        body: "hi",
        isGroup: false,
        chatId: "5511888",
        timestamp: 1700_000_000_000,
      })}\n`,
    );
    // Let microtasks run.
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledTimes(1);
    await backend.disconnect();
  });

  it("test_web_backend_dispatches_status_receipt", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const handler = vi.fn(async () => {});
    backend.onStatusReceipt(handler);
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    feed(
      child,
      `${JSON.stringify({
        event: "status",
        msgId: "wamid.s",
        status: "delivered",
        recipient: "5511",
        timestamp: 1700,
      })}\n`,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledTimes(1);
    await backend.disconnect();
  });

  it("test_web_backend_ipc_buffers_fragmented_line (EC-11)", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"rea');
    await new Promise((r) => setTimeout(r, 10));
    feed(child, 'dy","botPhone":"5511"}\n');
    expect(await connectP).toBe(true);
    await backend.disconnect();
  });
});
