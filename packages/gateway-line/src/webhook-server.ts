/**
 * Express webhook server for LINE inbound.
 *
 * Validates `X-Line-Signature` (HMAC-SHA256 over raw body) BEFORE
 * parsing/dispatch — 401 on missing or invalid (D408).
 *
 * @public
 */

import type { Express, NextFunction, Request, Response } from "express";

import type { LineAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import { verifyLineSignature } from "./signature.js";
import type { LineWebhookEnvelope } from "./types.js";

export interface WebhookServerOptions {
  readonly adapter: LineAdapter;
  /** Mount path; default `/line`. */
  readonly path?: string;
  /** Port to listen on when creating own Express app. Default 3000. */
  readonly port?: number;
  /** Inject an existing Express app. */
  readonly app?: Express;
}

export interface WebhookServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function loadExpress(): Promise<{ default: () => Express }> {
  try {
    const mod = await import("express");
    const fn = (mod as { default?: () => Express }).default ?? (mod as unknown as () => Express);
    return { default: fn };
  } catch {
    throw new ConfigurationError({
      code: "express_not_installed",
      message: 'gateway-line: peer-dep "express" not installed. Run: pnpm add express',
    });
  }
}

function rawCapture(req: Request, _res: Response, next: NextFunction): void {
  let buf = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    buf += chunk;
  });
  req.on("end", () => {
    (req as Request & { rawBody: string }).rawBody = buf;
    next();
  });
  req.on("error", (err) => next(err));
}

function handlerFactory(adapter: LineAdapter) {
  return (req: Request, res: Response): void => {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
    const signature = headerOf(req, "x-line-signature");
    if (!verifyLineSignature(adapter.getChannelSecret(), rawBody, signature)) {
      res.status(401).type("text/plain").send("invalid signature");
      return;
    }
    let envelope: LineWebhookEnvelope;
    try {
      envelope = JSON.parse(rawBody) as LineWebhookEnvelope;
    } catch {
      res.status(400).type("text/plain").send("invalid JSON body");
      return;
    }
    if (!Array.isArray(envelope.events)) {
      res.status(400).type("text/plain").send("missing 'events' array");
      return;
    }
    void adapter.dispatchWebhookBody(envelope);
    // LINE expects a 200 OK quickly to ack the webhook.
    res.status(200).end();
  };
}

function headerOf(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(",") : v;
}

export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const expressMod = await loadExpress();
  const app: Express = opts.app ?? expressMod.default();
  const path = opts.path ?? "/line";
  app.post(path, rawCapture, handlerFactory(opts.adapter));

  let server: import("node:http").Server | undefined;
  let started = false;
  let stopped = false;

  return {
    async start(): Promise<void> {
      if (started || opts.app !== undefined) {
        started = true;
        return;
      }
      const port = opts.port ?? 3000;
      await new Promise<void>((resolve) => {
        server = app.listen(port, () => resolve());
      });
      started = true;
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (server === undefined) return;
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = undefined;
    },
  };
}
