// Public API for @usetheo/gateway-mattermost (ADRs D397-D404).

export { MattermostAdapter, parsePostFromWS } from "./adapter.js";
export { connectMattermost, getChannelCached, wsUrlFromBase } from "./client.js";
export { ConfigurationError, SDKNotInstalledError } from "./errors.js";
export { hasMentionWithBoundary, shouldRespond } from "./filters.js";
export { mapChannelType, normalizeMattermostType, postToMessageEvent } from "./normalize.js";
export type {
  MattermostAdapterOptions,
  MattermostChannel,
  MattermostPost,
  MattermostUser,
} from "./types.js";
