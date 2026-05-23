/**
 * `WhatsAppCloudClient` — typed `fetch` wrapper for Meta WhatsApp Business
 * Cloud API (ADR D304). No Meta SDK; we own the wire.
 *
 * @internal
 */

import { mapWhatsAppCloudError } from "../../errors.js";
import type { WhatsAppSendResult } from "../../backend-types.js";
import type {
  MetaErrorEnvelope,
  MetaSendResponse,
  MetaSendTextRequest,
} from "./types.js";

export interface WhatsAppCloudClientOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly apiVersion?: string;
  /** Test seam. */
  readonly fetch?: typeof fetch;
}

export class WhatsAppCloudClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: WhatsAppCloudClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    const apiVersion = opts.apiVersion ?? "v18.0";
    this.baseUrl = `https://graph.facebook.com/${apiVersion}/${opts.phoneNumberId}`;
  }

  /** Send a text message. v1 scope — no media (D286 deferred). */
  async sendText(to: string, body: string, isGroup: boolean): Promise<WhatsAppSendResult> {
    const req: MetaSendTextRequest = isGroup
      ? {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body, preview_url: false },
        }
      : {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body, preview_url: false },
        };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.accessToken}`,
        },
        body: JSON.stringify(req),
      });
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "server_error",
          message: `Network error: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
      };
    }

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as MetaErrorEnvelope | unknown;
      return { ok: false, error: mapWhatsAppCloudError(response.status, errBody) };
    }

    const data = (await response.json()) as MetaSendResponse;
    const wamid = data.messages?.[0]?.id;
    if (wamid === undefined) {
      return { ok: false, error: { code: "unknown", message: "Meta returned no wamid." } };
    }
    return { ok: true, wamid };
  }

  /** Mark an inbound message as read (status receipt back to user). */
  async markAsRead(wamid: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: wamid,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
