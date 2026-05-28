/**
 * Lazy `@line/bot-sdk` loader + thin Client wrapper for sending.
 */

import { SDKNotInstalledError } from "./errors.js";

export interface LineSdkClient {
  replyMessage(
    replyToken: string,
    messages: Array<{ type: "text"; text: string }>,
  ): Promise<unknown>;
  pushMessage(to: string, messages: Array<{ type: "text"; text: string }>): Promise<unknown>;
}

interface LineSdkModule {
  Client: new (cfg: { channelAccessToken: string; channelSecret?: string }) => LineSdkClient;
  messagingApi?: {
    MessagingApiClient: new (cfg: { channelAccessToken: string }) => LineSdkClient;
  };
}

export async function loadLineSdk(): Promise<LineSdkModule> {
  try {
    const mod = await import("@line/bot-sdk");
    return mod as unknown as LineSdkModule;
  } catch {
    throw new SDKNotInstalledError("@line/bot-sdk");
  }
}

/**
 * Build a Client compatible with both legacy (`Client`) and v9 (`messagingApi.MessagingApiClient`).
 * We return the legacy shape (`replyMessage` / `pushMessage`) — v9 SDK exposes both styles.
 */
export function makeClient(
  mod: LineSdkModule,
  cfg: { channelAccessToken: string; channelSecret: string },
): LineSdkClient {
  if (mod.messagingApi?.MessagingApiClient !== undefined) {
    return new mod.messagingApi.MessagingApiClient({ channelAccessToken: cfg.channelAccessToken });
  }
  return new mod.Client(cfg);
}
