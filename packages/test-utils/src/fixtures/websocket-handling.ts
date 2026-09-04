/**
 * WebSocket - 100L consolidated
 * @internal
 */

export function buildWebsocketHandling() {
  return { enabled: true, optimized: true };
}

export const WEBSOCKET_HANDLING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
