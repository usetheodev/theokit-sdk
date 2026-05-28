/**
 * Lazy `matrix-js-sdk` loader.
 */

import { SDKNotInstalledError } from "./errors.js";
import type { MatrixClientLike } from "./sync.js";
import type { MatrixRoomLike } from "./types.js";

export interface MatrixSdkClient extends MatrixClientLike {
  startClient(opts: { initialSyncLimit: number }): Promise<void>;
  stopClient(): void;
  sendTextMessage(roomId: string, text: string): Promise<{ event_id: string }>;
  getRoomIdForAlias(alias: string): Promise<{ room_id: string }>;
  getRoom(roomId: string): MatrixRoomLike | null;
  isRoomEncrypted?(roomId: string): boolean;
  /** Best-effort current user id; matrix-js-sdk returns `string | null`. */
  getUserId(): string | null;
}

interface MatrixSdkModule {
  createClient(opts: { baseUrl: string; accessToken: string; userId: string }): MatrixSdkClient;
}

export async function loadMatrixSdk(): Promise<MatrixSdkModule> {
  try {
    const mod = await import("matrix-js-sdk");
    return mod as unknown as MatrixSdkModule;
  } catch {
    throw new SDKNotInstalledError();
  }
}
