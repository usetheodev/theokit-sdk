// Public API for @usetheo/gateway-matrix (ADRs D413-D421).

export { MatrixAdapter } from "./adapter.js";
export { AliasCache } from "./alias.js";
export { ConfigurationError, EncryptedRoomError, SDKNotInstalledError } from "./errors.js";
export { matrixEventToMessageEvent } from "./normalize.js";
export { detectChannelType } from "./room-state.js";
export type { MatrixClientLike, SyncFilterOpts, TimelineSubscription } from "./sync.js";
export { shouldDispatchSyncEvent, subscribeToTimeline } from "./sync.js";
export type {
  MatrixAdapterOptions,
  MatrixEventLike,
  MatrixRoomLike,
} from "./types.js";
