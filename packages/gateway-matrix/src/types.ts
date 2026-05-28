/**
 * Public option types + minimal Matrix shape narrowing (kept local so
 * we don't force `matrix-js-sdk` types on consumers).
 *
 * @public
 */

export interface MatrixAdapterOptions {
  /** Homeserver URL (e.g. `https://matrix.org`). No trailing slash. (D414) */
  readonly homeserverUrl: string;
  /** Long-lived access token (`syt_xxx`). Generate via Element → Settings → Help & About → Advanced. */
  readonly accessToken: string;
  /** Bot's full Matrix user id (`@bot:matrix.org`). */
  readonly userId: string;
  /**
   * EC-3 freshness window in milliseconds — events older than this on
   * initial sync are dropped. Default 60000 (60s).
   */
  readonly freshnessWindowMs?: number;
}

/**
 * Minimal subset of `MatrixEvent` we read. Real events from
 * `matrix-js-sdk` carry many more methods — preserved via
 * `event.matrix.raw`.
 *
 * @public
 */
export interface MatrixEventLike {
  getId(): string | undefined;
  getSender(): string | undefined;
  getRoomId(): string | undefined;
  getType(): string;
  getContent(): { body?: string; msgtype?: string };
  getTs(): number;
}

/**
 * Minimal subset of `Room` (sync timeline target).
 *
 * @public
 */
export interface MatrixRoomLike {
  readonly roomId: string;
  getJoinedMemberCount(): number;
  name?: string;
}
