/**
 * Minimal Chrome DevTools Protocol client for M144+ remote-debugging flow.
 *
 * Why this exists (and not puppeteer/playwright):
 * - Chrome M144+ doesn't expose /json/version HTTP endpoints when
 *   --remote-debugging is toggled via chrome://inspect; only the WebSocket
 *   URL at DevToolsActivePort works.
 * - Puppeteer requires `handleDevToolsAsPage: true` AND a postinstall
 *   chrome download dance.
 * - This file: ~80 LoC, zero install (uses `ws` from any nearby
 *   node_modules, otherwise points the user to `pnpm add -g ws`).
 *
 * Usage:
 *   import { CDP } from "./cdp.mjs";
 *   const cdp = new CDP();
 *   await cdp.connect();
 *   const { sessionId } = await cdp.attachToPage((p) => p.url.includes("telegram.org"));
 *   await cdp.send("Runtime.enable", {}, sessionId);
 *   const r = await cdp.send("Runtime.evaluate", { expression: "1+1", returnByValue: true }, sessionId);
 *   cdp.close();
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Try to load `ws` from any reachable node_modules. The skill setup script
// symlinks `lib/node_modules` to a directory containing `ws`. Fallback:
// search the user's npm cache.
let WebSocket;
try {
  const r = createRequire(import.meta.url);
  WebSocket = r("ws").WebSocket;
} catch {
  // Fallback: try Node 22+ built-in WebSocket
  WebSocket = globalThis.WebSocket;
  if (!WebSocket) {
    throw new Error(
      "Could not load `ws`. Run: cd .claude/skills/telegram-pro-dogfood && ./setup.sh",
    );
  }
}

const ACTIVE_FILE = "/home/paulo/.config/google-chrome/DevToolsActivePort";

export class CDP {
  constructor() {
    const active = readFileSync(ACTIVE_FILE, "utf8").trim().split("\n");
    this.port = active[0];
    this.path = active[1];
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = [];
  }

  async connect() {
    const url = `ws://127.0.0.1:${this.port}${this.path}`;
    this.ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.ws.once?.("open", resolve) ?? this.ws.addEventListener("open", resolve);
      this.ws.once?.("error", reject) ?? this.ws.addEventListener("error", reject);
    });
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WS dispatch + ws/uws compat shim is intentionally inline
    const onMessage = (ev) => {
      const data = ev?.data ?? ev;
      const msg = JSON.parse(typeof data === "string" ? data : String(data));
      if (msg.id !== undefined) {
        const slot = this.pending.get(msg.id);
        if (slot !== undefined) {
          this.pending.delete(msg.id);
          if (msg.error !== undefined)
            slot.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          else slot.resolve(msg.result);
        }
      } else if (msg.method !== undefined) {
        for (const l of this.eventListeners) l(msg);
      }
    };
    this.ws.on?.("message", (data) => onMessage(data)) ??
      this.ws.addEventListener("message", (ev) => onMessage(ev));
  }

  send(method, params, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params: params ?? {} };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 20000);
    });
  }

  async listPages() {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page");
  }

  async attachToPage(predicate) {
    const pages = await this.listPages();
    const target = pages.find(predicate);
    if (target === undefined) {
      throw new Error(
        "No matching page target. Available:\n  " +
          pages
            .map((p) => `${p.title?.slice(0, 50) ?? "(no title)"} → ${p.url.slice(0, 80)}`)
            .join("\n  "),
      );
    }
    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    return { sessionId, target };
  }

  onEvent(handler) {
    this.eventListeners.push(handler);
  }

  close() {
    if (this.ws !== null) this.ws.close();
  }
}
