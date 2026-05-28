/**
 * Public options + internal Mattermost shape narrowing.
 *
 * @public
 */

export interface MattermostAdapterOptions {
  /** Mattermost base URL, e.g. `https://mattermost.acme.com`. No trailing slash. (D400) */
  readonly baseUrl: string;
  /** Personal Access Token (D401). Get one in System Console → Integrations → Bot Accounts. */
  readonly accessToken: string;
  /**
   * Whether the bot should require an `@mention` in non-DM channels (D403).
   * Default: `true`. Set `false` to respond to every message in joined channels.
   */
  readonly requireMention?: boolean;
}

/**
 * Mattermost post shape (subset we read). Mirrors `@mattermost/types`
 * Post but kept minimal so the package compiles without a hard dep
 * on `@mattermost/types`.
 *
 * @public — exposed via `MattermostMessageEvent.mattermost.raw` typing.
 */
export interface MattermostPost {
  readonly id: string;
  readonly user_id: string;
  readonly channel_id: string;
  readonly root_id: string;
  readonly message: string;
  readonly create_at: number;
  readonly metadata?: {
    readonly mentions?: ReadonlyArray<string>;
  };
}

/**
 * Mattermost channel shape (subset).
 *
 * @public
 */
export interface MattermostChannel {
  readonly id: string;
  readonly team_id: string;
  readonly type: "D" | "G" | "O" | "P" | (string & {});
  readonly name?: string;
  readonly display_name?: string;
}

/**
 * Minimal user shape returned by `getMe`.
 *
 * @public
 */
export interface MattermostUser {
  readonly id: string;
  readonly username: string;
}
