/**
 * `createWebhookServer` — Express helper for inbound SMS webhooks.
 *
 * Registers per-backend routes (`/sms/twilio`, `/sms/plivo`, `/sms/vonage`)
 * each with the matching parser middleware. All three:
 *
 * 1. Read the raw body verbatim (signature verification depends on the
 *    exact bytes — even one extra `\r\n` invalidates the HMAC).
 * 2. Call `adapter.verifySignature(ctx)` → 401 if false.
 * 3. Call `adapter.buildEventFromCtx(ctx)` → `dispatchEvent(event)`.
 * 4. Return 204 No Content.
 *
 * Caller can pass an existing Express app (`opts.app`) or let the helper
 * create one. `start()` / `stop()` are idempotent.
 *
 * @public
 */

import type { Express, NextFunction, Request, Response } from "express";
import type { SMSAdapter } from "./adapter.js";
import type { SignatureContext } from "./backend-types.js";
import { ConfigurationError } from "./errors.js";

export interface WebhookServerOptions {
  readonly adapter: SMSAdapter;
  /** Mount path prefix; default `"/sms"`. The full path is `${path}/${backend}`. */
  readonly path?: string;
  /** Listen port. Ignored when `app` is provided. Default `3000`. */
  readonly port?: number;
  /** Inject an existing Express app instead of creating one. */
  readonly app?: Express;
}

export interface WebhookServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function loadExpress(): Promise<{ default: () => Express }> {
  try {
    const mod = await import("express");
    // Both ESM and CJS forms; normalize to { default }.
    const fn = (mod as { default?: () => Express }).default ?? (mod as unknown as () => Express);
    return { default: fn };
  } catch {
    throw new ConfigurationError({
      code: "express_not_installed",
      message: 'gateway-sms: peer-dep "express" not installed. Run: pnpm add express',
    });
  }
}

function buildSignatureContext(req: Request): SignatureContext {
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : (v ?? "");
  }
  const protoHeader = headers["x-forwarded-proto"];
  const proto = protoHeader ?? (req.secure ? "https" : "http");
  const host = req.get("host") ?? "localhost";
  const url = `${proto}://${host}${req.originalUrl}`;
  return { headers, rawBody, url };
}

export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const expressMod = await loadExpress();
  const app: Express = opts.app ?? expressMod.default();
  const prefix = opts.path ?? "/sms";
  const backend = opts.adapter.getBackendKind();

  // Raw-body capture middleware — must run BEFORE express.urlencoded/json,
  // since signature verification needs the exact byte sequence.
  const rawCapture = (req: Request, _res: Response, next: NextFunction) => {
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
  };

  const handler = (req: Request, res: Response): void => {
    const ctx = buildSignatureContext(req);
    if (!opts.adapter.verifySignature(ctx)) {
      res.status(401).type("text/plain").send("invalid signature");
      return;
    }
    let event: ReturnType<typeof opts.adapter.buildEventFromCtx>;
    try {
      event = opts.adapter.buildEventFromCtx(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).type("text/plain").send(`parse failed: ${msg}`);
      return;
    }
    void opts.adapter.dispatchEvent(event);
    // Twilio expects either TwiML or 204; 204 keeps things simple
    // and avoids accidentally double-replying.
    res.status(204).end();
  };

  app.post(`${prefix}/${backend}`, rawCapture, handler);

  let server: import("node:http").Server | undefined;
  let started = false;
  let stopped = false;

  return {
    async start(): Promise<void> {
      if (started || opts.app !== undefined) {
        // When caller injected its own app, we don't manage the listener.
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
