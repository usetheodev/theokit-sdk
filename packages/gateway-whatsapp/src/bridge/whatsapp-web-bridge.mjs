#!/usr/bin/env node
/**
 * whatsapp-web.js subprocess bridge.
 *
 * Spawned by `WhatsAppWebBackend.connect()`. Speaks JSON-lines over stdio:
 *  - stdin  ← commands (`{ cmd: "send" | "shutdown", ... }`)
 *  - stdout → events (`{ event: "ready" | "message" | "send_ack" | "status" | "error", ... }`)
 *
 * The user MUST have `whatsapp-web.js` installed in their app (peer dep).
 *
 * MUST carry `whatsapp-web-bridge` literally in argv (EC-5 cmdline guard).
 *
 * Usage: node whatsapp-web-bridge.mjs --tag whatsapp-web-bridge --session <id>
 *
 * @internal
 */

import { createInterface } from "node:readline";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitError(message) {
  emit({ event: "error", message });
}

let Client;
let LocalAuth;
try {
  const mod = await import("whatsapp-web.js");
  Client = mod.Client;
  LocalAuth = mod.LocalAuth;
} catch (err) {
  emitError(
    `whatsapp-web.js not installed in your app. Run \`pnpm add whatsapp-web.js\` to use the web backend. (${err?.message ?? err})`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const sessionIdIdx = args.indexOf("--session");
const sessionId = sessionIdIdx >= 0 ? args[sessionIdIdx + 1] : "default";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: sessionId }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", (qr) => {
  // QR is logged to stderr so the user can scan from terminal output.
  process.stderr.write(`\n[whatsapp-web bridge] Scan this QR with your WhatsApp app:\n${qr}\n\n`);
});

client.on("ready", () => {
  const phone = client.info?.wid?.user ?? "unknown";
  emit({ event: "ready", botPhone: phone });
});

client.on("message", (msg) => {
  try {
    emit({
      event: "message",
      msgId: msg.id?._serialized ?? `wa-${Date.now()}`,
      from: msg.from ?? "",
      body: msg.body ?? "",
      isGroup: typeof msg.from === "string" && msg.from.endsWith("@g.us"),
      chatId: msg.from ?? "",
      contactName: msg._data?.notifyName,
      timestamp: (msg.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
    });
  } catch (err) {
    emitError(`message handler failed: ${err?.message ?? err}`);
  }
});

client.on("message_ack", (msg, ack) => {
  // ack 1=sent, 2=delivered, 3=read, 4=played
  const statusMap = { 1: "sent", 2: "delivered", 3: "read" };
  const status = statusMap[ack];
  if (status === undefined) return;
  emit({
    event: "status",
    msgId: msg.id?._serialized ?? "",
    status,
    recipient: msg.to ?? msg.from ?? "",
    timestamp: Date.now(),
  });
});

client.on("auth_failure", (msg) => {
  emitError(`AUTHENTICATION_FAILURE: ${msg}`);
});

client.on("disconnected", (reason) => {
  emitError(`DISCONNECTED: ${reason}`);
});

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd?.cmd === "shutdown") {
    try {
      await client.destroy();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
  if (cmd?.cmd === "send") {
    const msgId = cmd.msgId;
    try {
      const sent = await client.sendMessage(cmd.to, cmd.text);
      emit({
        event: "send_ack",
        msgId,
        success: true,
        wamid: sent?.id?._serialized,
      });
    } catch (err) {
      emit({
        event: "send_ack",
        msgId,
        success: false,
        error: err?.message ?? String(err),
      });
    }
  }
});

// Kick off the auth/login flow.
client.initialize().catch((err) => {
  emitError(`initialize failed: ${err?.message ?? err}`);
  process.exit(1);
});
